// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemoteAndroidFrameApi } from './remote-android-frame-api'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', async () => ({
  callRuntimeRpc: mocks.rpc,
  ...(await import('../../../../shared/runtime-rpc-error-code'))
}))
const png = { pngBase64: 'iVBORw0KGgo=' }
const deviceId = 'ssh-adb:approved'
const renewal = {
  attached: true,
  info: { deviceUdid: deviceId, streamUrl: 'remote-adb://ssh-adb-stream:fresh' }
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.rpc.mockReset()
})
afterEach(() => vi.useRealTimers())
describe('remote Android screenshot stream', () => {
  it('restores only the owning workspace when renewing its preview', async () => {
    mocks.rpc.mockImplementation(async (_target, method) =>
      method === 'emulator.attach' ? renewal : png
    )
    const api = createRemoteAndroidFrameApi(deviceId, 'folder:own-workspace')
    const stream = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:old' })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      { kind: 'local' },
      'emulator.attach',
      {
        device: deviceId,
        previewStream: 'ssh-adb-stream:old',
        focus: false,
        worktree: 'folder:own-workspace'
      },
      expect.anything()
    )
    await api.stopFrameStream(stream)
  })
  it('renews the fenced ticket after a long park without changing a workspace default', async () => {
    mocks.rpc.mockImplementation(async (_target, method) =>
      method === 'emulator.attach' ? renewal : png
    )
    const api = createRemoteAndroidFrameApi(deviceId)
    const frame = vi.fn()
    api.onFrameStreamFrame(frame)
    const first = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:expired' })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      { kind: 'local' },
      'emulator.attach',
      {
        device: deviceId,
        previewStream: 'ssh-adb-stream:expired',
        focus: false
      },
      expect.anything()
    )
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      { kind: 'local' },
      'emulator.screenshot',
      {
        device: 'ssh-adb-stream:fresh'
      },
      expect.anything()
    )
    await api.stopFrameStream(first)
    await vi.advanceTimersByTimeAsync(61000)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    const second = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:expired' })
    await vi.advanceTimersByTimeAsync(0)
    expect(frame).toHaveBeenCalledTimes(2)
    expect(frame.mock.calls[1][0].streamId).toBe(second.streamId)
    await api.stopFrameStream(second)
  })
  it('reacquires approval after a transient screenshot failure and resumes frames', async () => {
    let captures = 0
    mocks.rpc.mockImplementation(async (_target, method) => {
      if (method === 'emulator.attach') {
        return renewal
      }
      if (++captures === 1) {
        throw new Error('WebSocket disconnected')
      }
      return png
    })
    const api = createRemoteAndroidFrameApi(deviceId)
    const frame = vi.fn()
    api.onFrameStreamFrame(frame)
    const stream = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:old' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.rpc.mock.calls.map((call) => call[1])).toEqual([
      'emulator.attach',
      'emulator.screenshot',
      'emulator.attach',
      'emulator.screenshot'
    ])
    expect(frame).toHaveBeenCalledOnce()
    await api.stopFrameStream(stream)
  })
  it('fails closed on revoked authorization and removes resume listeners on stop', async () => {
    mocks.rpc.mockRejectedValue(Object.assign(new Error('Revoked'), { code: 'forbidden' }))
    const api = createRemoteAndroidFrameApi(deviceId)
    const stream = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:old' })
    await vi.advanceTimersByTimeAsync(60000)
    window.dispatchEvent(new Event('focus'))
    expect(mocks.rpc).toHaveBeenCalledOnce()
    await api.stopFrameStream(stream)
    window.dispatchEvent(new Event('online'))
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('does not start a second request when the tab resumes during a capture', async () => {
    let finish: ((result: typeof png) => void) | undefined
    mocks.rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const api = createRemoteAndroidFrameApi()
    const stream = await api.startFrameStream({ streamUrl: 'remote-adb://ssh-adb-stream:old' })
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mocks.rpc).toHaveBeenCalledOnce()
    await api.stopFrameStream(stream)
    finish?.(png)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
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
