import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayDispatcher } from '../wsl-guest/transport/publication/dispatcher'
import type { RequestContext } from '../wsl-guest/transport/connection/dispatcher-contract'
import { GitResponseStreamRegistry } from './git-response-stream'
import { STREAM_ACK_WINDOW_CHUNKS } from '../wsl-guest/transport/wire/protocol'

const context: RequestContext = { clientId: 7, isStale: () => false }

async function flushPump(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('GitResponseStreamRegistry shutdown', () => {
  const registries: GitResponseStreamRegistry[] = []

  let dispatcher: RelayDispatcher

  beforeEach(() => {
    dispatcher = new RelayDispatcher(() => true)
  })

  function fixture(drainTimeoutMs?: number) {
    const registry = new GitResponseStreamRegistry(drainTimeoutMs)
    registries.push(registry)
    const notifyBulk = vi.spyOn(dispatcher, 'notifyBulk').mockResolvedValue(undefined)
    vi.spyOn(dispatcher, 'producerDataBudget').mockReturnValue(64)
    return { registry, dispatcher, notifyBulk }
  }

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((registry) => registry.disposeAllAndWait()))
    dispatcher.dispose()
  })

  it('drains a scheduled producer without publishing any frames', async () => {
    const { registry, dispatcher, notifyBulk } = fixture()
    registry.startStream(Buffer.from('payload'), dispatcher, context)

    await registry.disposeAllAndWait()
    await flushPump()

    expect(notifyBulk).not.toHaveBeenCalled()
    expect(() => registry.startStream(Buffer.from('next'), dispatcher, context)).toThrow(
      'relay_response_stream_shutdown_fenced'
    )
    await registry.disposeAllAndWait()
  })

  it('waits for an in-flight final chunk and never publishes responseEnd after abort', async () => {
    const { registry, dispatcher, notifyBulk } = fixture()
    const write = deferred()
    notifyBulk.mockImplementationOnce(() => write.promise)
    registry.startStream(Buffer.from('one chunk'), dispatcher, context)
    await flushPump()
    expect(notifyBulk).toHaveBeenCalledTimes(1)

    let drained = false
    const firstDrain = registry.disposeAllAndWait().then(() => {
      drained = true
    })
    const secondDrain = registry.disposeAllAndWait()
    try {
      await flushPump()
      expect(drained).toBe(false)
      expect(() => registry.startStream(Buffer.from('next'), dispatcher, context)).toThrow(
        'relay_response_stream_shutdown_fenced'
      )
    } finally {
      write.resolve()
      await Promise.all([firstDrain, secondDrain])
    }

    expect(drained).toBe(true)
    expect(notifyBulk).toHaveBeenCalledTimes(1)
    expect(notifyBulk.mock.calls[0]?.[0]).toBe('git.responseChunk')
  })

  it('rejects, so shutdown defers, when a pump stays parked past the drain deadline', async () => {
    const { registry, dispatcher, notifyBulk } = fixture(20)
    const parked = deferred()
    notifyBulk.mockReturnValue(parked.promise)
    registry.startStream(Buffer.from('one chunk'), dispatcher, context)
    await flushPump()

    try {
      await expect(registry.disposeAllAndWait()).rejects.toThrow(
        'relay_response_stream_operations_unsettled'
      )
    } finally {
      parked.resolve()
      await registry.disposeAllAndWait()
    }
  })

  it('wakes producers parked on client ACKs without waiting for the stall timer', async () => {
    const { registry, dispatcher, notifyBulk } = fixture()
    // The fixture's 64 encoded bytes fit 48 payload bytes per chunk.
    registry.startStream(Buffer.alloc(48 * (STREAM_ACK_WINDOW_CHUNKS + 1)), dispatcher, context)
    await flushPump()
    expect(notifyBulk).toHaveBeenCalledTimes(STREAM_ACK_WINDOW_CHUNKS)

    let drained = false
    const drain = registry.disposeAllAndWait().then(() => {
      drained = true
    })
    await flushPump()

    expect(drained).toBe(true)
    await drain
    expect(notifyBulk).toHaveBeenCalledTimes(STREAM_ACK_WINDOW_CHUNKS)
    expect(notifyBulk.mock.calls.every(([method]) => method === 'git.responseChunk')).toBe(true)
  })

  it('waits for an already-published responseEnd to settle', async () => {
    const { registry, dispatcher, notifyBulk } = fixture()
    const endWrite = deferred()
    notifyBulk.mockResolvedValueOnce(undefined).mockImplementationOnce(() => endWrite.promise)
    registry.startStream(Buffer.from('payload'), dispatcher, context)
    await flushPump()
    expect(notifyBulk.mock.calls.map(([method]) => method)).toEqual([
      'git.responseChunk',
      'git.responseEnd'
    ])

    let drained = false
    const drain = registry.disposeAllAndWait().then(() => {
      drained = true
    })
    try {
      await flushPump()
      expect(drained).toBe(false)
    } finally {
      endWrite.resolve()
      await drain
    }
    expect(drained).toBe(true)
    expect(notifyBulk).toHaveBeenCalledTimes(2)
  })

  it('suppresses error publication when an aborted in-flight write rejects', async () => {
    const { registry, dispatcher, notifyBulk } = fixture()
    let rejectWrite!: (error: Error) => void
    notifyBulk.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject
        })
    )
    registry.startStream(Buffer.from('payload'), dispatcher, context)
    await flushPump()

    const drain = registry.disposeAllAndWait()
    rejectWrite(new Error('channel closed during shutdown'))
    await drain

    expect(notifyBulk).toHaveBeenCalledTimes(1)
    expect(notifyBulk.mock.calls[0]?.[0]).toBe('git.responseChunk')
  })

  it('synchronous disposal also permanently fences admission and retains the pending drain', async () => {
    const { registry, dispatcher, notifyBulk } = fixture()
    const write = deferred()
    notifyBulk.mockImplementationOnce(() => write.promise)
    registry.startStream(Buffer.from('payload'), dispatcher, context)
    await flushPump()
    registry.disposeAll()

    let drained = false
    const drain = registry.disposeAllAndWait().then(() => {
      drained = true
    })
    try {
      expect(() => registry.startStream(Buffer.from('next'), dispatcher, context)).toThrow(
        'relay_response_stream_shutdown_fenced'
      )
      await flushPump()
      expect(drained).toBe(false)
    } finally {
      write.resolve()
      await drain
    }

    expect(notifyBulk).toHaveBeenCalledTimes(1)
    await registry.disposeAllAndWait()
  })
})
