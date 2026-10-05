import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { spawnSystemSshCommand } from './system-ssh-command'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./system-ssh-binary', () => ({ findSystemSsh: () => '/usr/bin/ssh' }))
vi.mock('./system-ssh-args', () => ({ buildSshArgs: () => ['example.test'] }))

describe('system SSH command stdin', () => {
  it('delivers script bytes and EOF to the actual SSH process', async () => {
    const stdin = new PassThrough()
    let received = ''
    stdin.on('data', (chunk) => {
      received += chunk.toString()
    })
    const process = Object.assign(new EventEmitter(), {
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn()
    })
    mocks.spawn.mockReturnValue(process)
    const channel = spawnSystemSshCommand(
      { id: 'test', label: 'test', host: 'example.test', port: 22, username: 'developer' },
      'node -'
    )
    const closed = vi.fn()
    channel.on('close', closed)
    channel.resume()
    await new Promise<void>((resolve, reject) => {
      channel.once('error', reject)
      channel.end('console.log("probe")', resolve)
    })
    expect(received).toBe('console.log("probe")')
    expect(stdin.writableEnded).toBe(true)
    process.stdout.end('probe result')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(closed).not.toHaveBeenCalled()
    process.emit('close', 0)
    expect(closed).toHaveBeenCalledExactlyOnceWith(0, undefined)
  })
})
