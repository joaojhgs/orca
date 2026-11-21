import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayDispatcher } from '../wsl-guest/transport/publication/dispatcher'
import type { RequestContext } from '../wsl-guest/transport/connection/dispatcher-contract'
import { GitResponseStreamRegistry } from './git-response-stream'
import { STREAM_ACK_WINDOW_CHUNKS } from '../wsl-guest/transport/wire/protocol'

async function flushPump(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('GitResponseStreamRegistry client ownership', () => {
  const registries: GitResponseStreamRegistry[] = []
  let dispatcher: RelayDispatcher

  beforeEach(() => {
    dispatcher = new RelayDispatcher(() => true)
  })

  afterEach(() => {
    for (const registry of registries) {
      registry.disposeAll()
    }
    registries.length = 0
    dispatcher.dispose()
  })

  it('ignores acknowledgements and cancellation from a different relay client', async () => {
    const ownerClientId = 7
    const notifyBulk = vi.spyOn(dispatcher, 'notifyBulk').mockResolvedValue(undefined)
    // Four encoded bytes give three payload bytes per chunk.
    vi.spyOn(dispatcher, 'producerDataBudget').mockReturnValue(4)
    const context: RequestContext = {
      clientId: ownerClientId,
      isStale: () => false
    }
    const registry = new GitResponseStreamRegistry()
    registries.push(registry)
    const payload = Buffer.alloc(3 * STREAM_ACK_WINDOW_CHUNKS * 3)
    const marker = registry.startStream(payload, dispatcher, context)
    const streamId = marker.__orcaGitResponseStream.streamId

    await flushPump()
    expect(notifyBulk).toHaveBeenCalledTimes(STREAM_ACK_WINDOW_CHUNKS)

    registry.recordAck(streamId, 10_000, ownerClientId + 1)
    await flushPump()
    expect(notifyBulk).toHaveBeenCalledTimes(STREAM_ACK_WINDOW_CHUNKS)

    registry.abort(streamId, ownerClientId + 1)
    registry.recordAck(streamId, STREAM_ACK_WINDOW_CHUNKS - 1, ownerClientId)
    await flushPump()
    expect(notifyBulk.mock.calls.length).toBeGreaterThan(STREAM_ACK_WINDOW_CHUNKS)
  })

  it('contains a secondary failure while reporting a stream error', async () => {
    vi.spyOn(dispatcher, 'producerDataBudget').mockReturnValue(64)
    const notifyBulk = vi
      .spyOn(dispatcher, 'notifyBulk')
      .mockRejectedValue(new Error('socket closed'))
    const registry = new GitResponseStreamRegistry()
    registries.push(registry)

    registry.startStream(Buffer.from('payload'), dispatcher, {
      clientId: 7,
      isStale: () => false
    })

    await flushPump()
    await flushPump()

    expect(notifyBulk).toHaveBeenCalledTimes(2)
    expect(notifyBulk.mock.calls[0]?.[0]).toBe('git.responseChunk')
    expect(notifyBulk.mock.calls[1]?.[0]).toBe('git.responseError')
  })

  it('uses encoded producer capacity without collapsing chunks during saturation', async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const notifyBulk = vi
      .spyOn(dispatcher, 'notifyBulk')
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined)
    const producerDataBudget = vi.spyOn(dispatcher, 'producerDataBudget').mockReturnValue(8)
    const registry = new GitResponseStreamRegistry()
    registries.push(registry)
    const ownerClientId = 7

    const marker = registry.startStream(Buffer.alloc(12), dispatcher, {
      clientId: ownerClientId,
      isStale: () => false
    })
    const streamId = marker.__orcaGitResponseStream.streamId
    await flushPump()
    expect(notifyBulk).toHaveBeenCalledTimes(1)

    registry.recordAck(streamId, 1_000, ownerClientId)
    releaseFirst()
    await flushPump()
    await flushPump()

    expect(producerDataBudget).toHaveBeenCalledExactlyOnceWith(
      'git.responseChunk',
      { streamId, seq: 12 },
      ownerClientId
    )
    expect(marker.__orcaGitResponseStream.chunkCount).toBe(2)
    expect(notifyBulk).toHaveBeenCalledTimes(3)
    const chunks = notifyBulk.mock.calls
      .filter(([method]) => method === 'git.responseChunk')
      .map(([, params]) => {
        const data = params?.data
        if (typeof data !== 'string') {
          throw new Error('Git response chunk has no encoded data')
        }
        return data
      })
    expect(chunks).toHaveLength(2)
    expect(chunks.every((data) => data.length <= 8)).toBe(true)
    expect(chunks.map((data) => Buffer.from(data, 'base64').length)).toEqual([6, 6])
  })
})
