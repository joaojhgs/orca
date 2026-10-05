// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemoteAndroidFrameApi } from './remote-android-frame-api'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.rpc }))
beforeEach(() => {
  vi.useFakeTimers()
  mocks.rpc.mockReset()
})
afterEach(() => vi.useRealTimers())
describe('remote Android screenshot stream', () => {
  it('polls only the fenced stream identity with one request at a time', async () => {
    mocks.rpc.mockResolvedValue({ pngBase64: 'iVBORw0KGgo=' })
    const api = createRemoteAndroidFrameApi()
    const frame = vi.fn()
    api.onFrameStreamFrame(frame)
    const stream = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:opaque' })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.rpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'emulator.screenshot',
      { device: 'ssh-adb-stream:opaque' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: stream.streamId, bytes: expect.any(ArrayBuffer) })
    )
    await api.stopFrameStream(stream)
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects unfenced URLs and never displays late frames after cancellation', async () => {
    const api = createRemoteAndroidFrameApi()
    const frame = vi.fn()
    api.onFrameStreamFrame(frame)
    await expect(api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb:old' })).rejects.toThrow(
      /Invalid/
    )
    let finish: ((value: { pngBase64: string }) => void) | undefined
    mocks.rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const stream = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:opaque' })
    await vi.advanceTimersByTimeAsync(0)
    await api.stopFrameStream(stream)
    finish?.({ pngBase64: 'iVBORw0KGgo=' })
    await vi.advanceTimersByTimeAsync(0)
    expect(frame).not.toHaveBeenCalled()
  })
  it('stops on invalid screenshot data without retrying another host', async () => {
    mocks.rpc.mockResolvedValue({ pngBase64: 'bm90LXBuZw==' })
    const api = createRemoteAndroidFrameApi()
    const error = vi.fn()
    api.onFrameStreamError(error)
    await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:opaque' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid Android screenshot' })
    )
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
