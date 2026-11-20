import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer as createTcpServer } from 'node:net'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import {
  consumeAgentForwardTicket,
  mintAgentForwardTicket,
  readAgentForwardPolicy
} from './agent-forward-access'
import { AgentForwardWebSocketBridge } from '../runtime/rpc/agent-forward-websocket-bridge'

const authority = vi.hoisted(() => ({ current: true, connected: true }))
vi.mock('../ssh/ssh-provider-authority', () => ({
  isCurrentSshProviderAuthority: () => authority.current
}))
vi.mock('../computer/ssh-desktop-vnc-route', () => ({
  requireDesktopSshAuthority: (targetId: string) => {
    if (!authority.connected) {
      throw new Error('Disconnected')
    }
    return { targetId }
  },
  openDesktopSshRoute: async () => ({
    connect: ({ host, port }: { host: string; port: number }) => connect({ host, port }),
    isValid: () => authority.current,
    close: () => {}
  })
}))

let directory = ''
const route = {
  id: 'test',
  label: 'Approved test',
  targetId: 'personal',
  host: '127.0.0.1',
  port: 8000
}
function policy(routes: unknown[] = [route], publicOrigin = 'https://orca.example.test') {
  writeFileSync(
    join(directory, 'network-forward-policy.json'),
    JSON.stringify({ publicOrigin, routes }),
    { mode: 0o600 }
  )
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-agent-forward-'))
  installFakeAppEnvironment({ getPath: () => directory })
  authority.current = true
  authority.connected = true
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('owner-approved agent forwarding', () => {
  it('denies arbitrary destinations and missing policy', () => {
    expect(readAgentForwardPolicy().routes).toEqual([])
    expect(() => mintAgentForwardTicket('unknown')).toThrow(/not approved/)
    policy()
    expect(() => mintAgentForwardTicket('100.64.0.3:22')).toThrow(/not approved/)
    expect(() => mintAgentForwardTicket('test')).not.toThrow()
  })
  it('rejects non-literal destinations, duplicate IDs, non-HTTPS origins and writable policies', () => {
    for (const routes of [
      [{ ...route, host: 'metadata.internal' }],
      [route, route],
      [{ ...route, port: 0 }]
    ]) {
      policy(routes)
      expect(() => readAgentForwardPolicy()).toThrow()
    }
    policy([route], 'http://orca.example.test')
    expect(() => readAgentForwardPolicy()).toThrow()
    policy()
    chmodSync(join(directory, 'network-forward-policy.json'), 0o666)
    expect(() => readAgentForwardPolicy()).toThrow(/policy file/)
  })
  it('rejects symlink and relative policy paths', () => {
    policy()
    const link = join(directory, 'link.json')
    symlinkSync(join(directory, 'network-forward-policy.json'), link)
    vi.stubEnv('ORCA_NETWORK_FORWARD_POLICY_FILE', link)
    expect(() => readAgentForwardPolicy()).toThrow(/policy file/)
    vi.stubEnv('ORCA_NETWORK_FORWARD_POLICY_FILE', 'relative.json')
    expect(() => readAgentForwardPolicy()).toThrow(/absolute/)
  })
  it('uses expiring single-use tickets fenced by policy and SSH authority', () => {
    policy()
    const ticket = () =>
      new URL(mintAgentForwardTicket('test').url).searchParams.get('ticket') ?? ''
    const first = ticket()
    expect(consumeAgentForwardTicket(first)?.id).toBe('test')
    expect(consumeAgentForwardTicket(first)).toBeNull()
    const expired = ticket()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31000)
    expect(consumeAgentForwardTicket(expired)).toBeNull()
    vi.restoreAllMocks()
    const revoked = ticket()
    policy([])
    expect(consumeAgentForwardTicket(revoked)).toBeNull()
    policy()
    const disconnected = ticket()
    authority.current = false
    expect(consumeAgentForwardTicket(disconnected)).toBeNull()
    authority.connected = false
    expect(() => mintAgentForwardTicket('test')).toThrow(/Disconnected/)
  })
  it('relays binary TCP data and FIN; closes live connections when approval is revoked', async () => {
    const tcp = createTcpServer({ allowHalfOpen: true }, (socket) => {
      socket.on('data', (data) => socket.write(data))
      socket.on('end', () => socket.end())
    })
    tcp.listen(0, '127.0.0.1')
    await once(tcp, 'listening')
    const tcpAddress = tcp.address()
    if (!tcpAddress || typeof tcpAddress === 'string') {
      throw new Error('Missing TCP address')
    }
    policy([{ ...route, port: tcpAddress.port }])
    const bridge = new AgentForwardWebSocketBridge()
    const http = createServer()
    http.on('upgrade', (req, socket, head) => bridge.tryUpgrade(req, socket, head))
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const address = http.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing HTTP address')
    }
    const open = () => {
      const ticket = new URL(mintAgentForwardTicket('test').url).searchParams.get('ticket')
      return new WebSocket(`ws://127.0.0.1:${address.port}/agent-port-forward?ticket=${ticket}`)
    }
    try {
      const client = open()
      const [ready] = await once(client, 'message')
      expect(JSON.parse(ready.toString()).type).toBe('ready')
      const payload = Buffer.from([0, 255, 1, 128, 65])
      client.send(payload)
      const [echo, binary] = await once(client, 'message')
      expect(binary).toBe(true)
      expect(Buffer.from(echo)).toEqual(payload)
      const ended = once(client, 'close')
      client.send('{"type":"end"}')
      const [fin] = await once(client, 'message')
      expect(fin.toString()).toBe('{"type":"end"}')
      await ended
      const revoked = open()
      await once(revoked, 'message')
      const closed = once(revoked, 'close')
      policy([])
      await closed
    } finally {
      bridge.stop()
      http.close()
      tcp.close()
    }
  })
})
