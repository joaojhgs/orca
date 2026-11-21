import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { spawnProcess } from '@orca/process-host'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { WebSocket } from 'ws'

// Bundling and starting a separate Node process can outlast the default timeout on CI.
it('starts CDP on the calling relay and requests a ticket for the selected browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orca-relay-cdp-'))
  try {
    const companion = join(directory, 'network-forward.cjs')
    const controller = join(directory, 'relay.cjs')
    const ticketRequest = join(directory, 'ticket-request.json')
    await build({
      entryPoints: ['src/relay/relay-network-forward-entry.ts'],
      outfile: companion,
      bundle: true,
      platform: 'node',
      format: 'cjs'
    })
    await writeFile(
      controller,
      `const fs = require('node:fs')\n` +
        `fs.writeFileSync(${JSON.stringify(ticketRequest)}, JSON.stringify(process.argv.slice(2)))\n` +
        `console.log(JSON.stringify({ ok: true, result: { browserId: 'approved-browser', url: 'ws://127.0.0.1:1' } }))`
    )
    const relayArgs = ['--sock-path', '/fixture/relay.sock', '--orca-cli']
    const child = spawnProcess({
      program: process.execPath,
      args: [
        companion,
        controller,
        ...relayArgs,
        'computer',
        'browser-connect',
        '--browser',
        'approved-browser',
        '--json'
      ],
      cwd: directory,
      stdio: 'pipe'
    })
    const exited = once(child, 'close')
    const lines = createInterface({ input: child.stdout })
    try {
      const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(8_000) })
      const ready: { browserId: string; endpoint: string; loopbackOnly: boolean } = JSON.parse(line)
      expect(ready.browserId).toBe('approved-browser')
      expect(ready.loopbackOnly).toBe(true)
      const endpoint = new URL(ready.endpoint)
      expect(endpoint.hostname).toBe('127.0.0.1')
      const version = await fetch(`http://${endpoint.host}${endpoint.pathname}/json/version`)
      expect(await version.json()).toMatchObject({ webSocketDebuggerUrl: ready.endpoint })
      const unauthorized = await fetch(`http://${endpoint.host}/json/version`)
      expect(unauthorized.status).toBe(403)

      const socket = new WebSocket(ready.endpoint, { handshakeTimeout: 5_000 })
      // The fake relay intentionally supplies an insecure URL, so no browser connection is made.
      await once(socket, 'error')
      expect(JSON.parse(await readFile(ticketRequest, 'utf8'))).toEqual([
        ...relayArgs,
        'computer',
        'browser-ticket',
        '--browser',
        'approved-browser',
        '--json'
      ])
    } finally {
      lines.close()
      child.kill()
      await exited
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15_000)
