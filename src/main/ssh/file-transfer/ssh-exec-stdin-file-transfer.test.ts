import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import type { SshConnection } from '../connection/ssh-connection'
import { execCommand } from '../remote-exec/remote-exec-command'
import {
  uploadDirectoryViaExecStdin,
  uploadFileViaExecStdin,
  writeStringViaExecStdin
} from './ssh-exec-stdin-file-transfer'
import { getRemoteHostPlatform } from '../remote-host/ssh-remote-platform'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'exec-stdin-'))
  directories.push(dir)
  return dir
}

/** An ssh2-shaped exec channel over a local `/bin/sh -c`, so the real writer and shell run. */
function localShellConnection(
  rewrite: (command: string) => string = (c) => c,
  separateStdin = false
): SshConnection {
  const conn = {
    usesSystemSshTransport: () => separateStdin,
    execWithClosedStdin: async (command: string) => {
      const channel = await conn.exec(command)
      channel.stdin.end()
      return channel
    },
    exec: async (command: string) => {
      const child = spawnProcess({ program: '/bin/sh', args: ['-c', rewrite(command)] })
      const channel = new Duplex({
        autoDestroy: false,
        emitClose: false,
        read() {},
        // Model ssh2 dropping writes after remote stdin closes; local EPIPE must not mask the host exit failure.
        write(chunk, encoding, callback) {
          if (child.stdin.destroyed) {
            callback()
            return
          }
          child.stdin.write(chunk, encoding, () => callback())
        },
        final(callback) {
          if (child.stdin.destroyed) {
            callback()
            return
          }
          child.stdin.end(() => callback())
        }
      })
      child.stdin.on('error', () => {})
      child.stdout.on('data', (data: Buffer) => channel.push(data))
      child.on('close', (code) => {
        channel.push(null)
        channel.emit('close', code)
      })
      return Object.assign(channel, {
        stdin: separateStdin ? child.stdin : channel,
        stderr: child.stderr,
        close: () => child.kill('SIGKILL')
      })
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand only uses exec() and the channel surface built above.
  return conn as unknown as SshConnection
}

describe.skipIf(process.platform === 'win32')('exec-stdin writer through a real shell', () => {
  it.each([false, true])(
    'delivers buffered input with separate stdin=%s',
    async (separateStdin) => {
      const payload = 'literal $HOME; `uname`; quotes "\' and Unicode λ\n'
      expect(
        await execCommand(localShellConnection(undefined, separateStdin), 'cat', { input: payload })
      ).toBe(payload)
      expect(
        await execCommand(localShellConnection(undefined, separateStdin), 'cat', {
          input: Buffer.from(payload)
        })
      ).toBe(payload)
    }
  )

  it('sends EOF for empty input and preserves the configurable output tail', async () => {
    expect(await execCommand(localShellConnection(), 'cat', { input: '' })).toBe('')
    expect(
      await execCommand(localShellConnection(), 'cat', { input: 'abcdef', maxOutputChars: 3 })
    ).toBe('def')
  })

  it('rejects simultaneous streamed and buffered input before executing', async () => {
    const stdin = Readable.from(['stream'])
    await expect(
      execCommand(localShellConnection(), 'exit 99', { stdin, input: 'buffer' })
    ).rejects.toThrow('Specify either SSH command stdin or input, not both')
    stdin.destroy()
  })

  it.each([0, -1, 1.5, 16 * 1024 * 1024 + 1])('rejects output limit %s', async (limit) => {
    await expect(
      execCommand(localShellConnection(), 'exit 99', { maxOutputChars: limit })
    ).rejects.toThrow('Invalid SSH command output limit')
  })

  it('leaves no file behind when the host receives fewer bytes than were sent', async () => {
    const dir = tempDir()
    const local = join(dir, 'payload.bin')
    // Larger than any pipe buffer, so the shell always stops reading while bytes are still in flight.
    writeFileSync(local, randomBytes(1024 * 1024))
    const remote = join(dir, 'remote', 'payload.bin')
    // Models a stream cut short: the host keeps only the first 1000 bytes.
    const truncating = localShellConnection((command) =>
      command.replace(/cat > /, 'head -c 1000 > ')
    )

    await expect(uploadFileViaExecStdin(truncating, local, remote)).rejects.toThrow(/exit 1/)
    expect(existsSync(remote)).toBe(false)
    expect(readdirSync(join(dir, 'remote'))).toEqual([])
  })

  it('uploads a directory tree, including empty directories and executable modes', async () => {
    const dir = tempDir()
    const local = join(dir, 'local')
    mkdirSync(join(local, 'bin'), { recursive: true })
    mkdirSync(join(local, 'empty'))
    writeFileSync(join(local, 'relay.js'), 'console.log(1)\n')
    writeFileSync(join(local, 'bin', 'spawn-helper'), '#!/bin/sh\n')
    await chmod(join(local, 'bin', 'spawn-helper'), 0o755)
    const remote = join(dir, 'remote')

    await uploadDirectoryViaExecStdin(
      localShellConnection(),
      local,
      remote,
      getRemoteHostPlatform('linux-x64')
    )
    await writeStringViaExecStdin(localShellConnection(), join(remote, '.version'), '0.1.0+abc')

    expect(readFileSync(join(remote, 'relay.js'), 'utf8')).toBe('console.log(1)\n')
    expect(existsSync(join(remote, 'empty'))).toBe(true)
    expect(readFileSync(join(remote, '.version'), 'utf8')).toBe('0.1.0+abc')
    expect(statSync(join(remote, 'bin', 'spawn-helper')).mode & 0o111).not.toBe(0)
  })
})
