import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { SshConnection } from '../ssh/ssh-connection'
import { execCommand } from '../ssh/ssh-relay-exec-command'
import {
  cachedObserverInput,
  ensureRemoteObserver,
  invalidateRemoteObserver
} from './observer-remote-cache'

vi.mock('../ssh/ssh-relay-exec-command', () => ({ execCommand: vi.fn() }))

function fixture() {
  const state = { connectionGeneration: 1 }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Cache only reads the connection generation; exec is mocked.
  const connection = { getConnectGeneration: () => state.connectionGeneration } as SshConnection
  return { connection, state }
}

beforeEach(() => vi.mocked(execCommand).mockReset())

describe('remote execution-observer cache', () => {
  it('shares concurrent installation and sends only small requests afterwards', async () => {
    const { connection } = fixture()
    const bundle = '/* observer */'.repeat(50000)
    vi.mocked(execCommand)
      .mockResolvedValueOnce('ORCA_OBSERVER_CACHE:null\n')
      .mockResolvedValueOnce('ORCA_OBSERVER_CACHE:"/home/dev/cache.cjs"\n')
    const [one, two] = await Promise.all([
      ensureRemoteObserver(connection, 'node -', bundle, true),
      ensureRemoteObserver(connection, 'node -', bundle, true)
    ])
    expect(one).toEqual(two)
    expect(execCommand).toHaveBeenCalledTimes(2)
    expect(vi.mocked(execCommand).mock.calls[1]?.[2]?.input).toContain('gunzipSync')
    expect(vi.mocked(execCommand).mock.calls[1]?.[2]?.input).toContain('mode: 0o600')
    expect(cachedObserverInput(one.file, one.digest, 'request').length).toBeLessThan(1500)
    await ensureRemoteObserver(connection, 'node -', bundle, true)
    expect(execCommand).toHaveBeenCalledTimes(2)
  })

  it('reuses verified disk content after reconnect but not another host’s installation', async () => {
    const first = fixture(),
      second = fixture()
    vi.mocked(execCommand).mockResolvedValue('ORCA_OBSERVER_CACHE:"/cache.cjs"\n')
    await ensureRemoteObserver(first.connection, 'node -', 'bundle', false)
    first.state.connectionGeneration++
    await ensureRemoteObserver(first.connection, 'node -', 'bundle', false)
    await ensureRemoteObserver(second.connection, 'node -', 'bundle', false)
    expect(execCommand).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(execCommand).mock.calls) {
      expect(call[2]).toMatchObject({ wrapCommand: false })
      expect(call[2]?.input).not.toContain('gunzipSync')
    }
  })

  it('allows a later request to retry a failed cache setup, without replaying an observation', async () => {
    const { connection } = fixture()
    vi.mocked(execCommand).mockRejectedValueOnce(new Error('link lost'))
    await expect(ensureRemoteObserver(connection, 'node -', 'bundle', true)).rejects.toThrow(
      'link lost'
    )
    vi.mocked(execCommand).mockResolvedValue('ORCA_OBSERVER_CACHE:"/cache.cjs"\n')
    await expect(ensureRemoteObserver(connection, 'node -', 'bundle', true)).resolves.toMatchObject(
      { file: '/cache.cjs' }
    )
    expect(execCommand).toHaveBeenCalledTimes(2)
  })

  it('does not invalidate the replacement generation because an old request failed', async () => {
    const { connection, state } = fixture()
    vi.mocked(execCommand).mockResolvedValue('ORCA_OBSERVER_CACHE:"/cache.cjs"\n')
    const cached = await ensureRemoteObserver(connection, 'node -', 'bundle', true)
    state.connectionGeneration++
    await ensureRemoteObserver(connection, 'node -', 'bundle', true)
    invalidateRemoteObserver(connection, cached.digest, 1)
    await ensureRemoteObserver(connection, 'node -', 'bundle', true)
    expect(execCommand).toHaveBeenCalledTimes(2)
    invalidateRemoteObserver(connection, cached.digest, 2)
    await ensureRemoteObserver(connection, 'node -', 'bundle', true)
    expect(execCommand).toHaveBeenCalledTimes(3)
  })

  it('checks cached bytes before compilation and never puts request content in a shell command', () => {
    const digest = createHash('sha256').update('bundle').digest('hex')
    const script = cachedObserverInput('/cache.cjs', digest, 'request')
    expect(script).toContain(digest)
    expect(script).toContain('stat.isFile()')
    expect(script.indexOf("digest('hex')")).toBeLessThan(script.indexOf('loaded._compile'))
  })
})
