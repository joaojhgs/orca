import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { createBrowserUuid } from '@/lib/browser-uuid'

type Frame = { streamId: string; bytes: ArrayBuffer }
type FrameError = { streamId: string; message: string }

export function createRemoteAndroidFrameApi() {
  const frames = new Set<(frame: Frame) => void>()
  const errors = new Set<(error: FrameError) => void>()
  let active: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: AbortController | undefined
  return {
    onFrameStreamFrame(callback: (frame: Frame) => void) {
      frames.add(callback)
      return () => frames.delete(callback)
    },
    onFrameStreamError(callback: (error: FrameError) => void) {
      errors.add(callback)
      return () => errors.delete(callback)
    },
    async startFrameStream({ streamUrl }: { streamUrl: string; streamKey?: string }) {
      if (!streamUrl.startsWith('remote-adb://ssh-adb-stream:')) {
        throw new Error('Invalid remote Android preview')
      }
      const device = streamUrl.slice('remote-adb://'.length)
      const streamId = createBrowserUuid()
      active = streamId
      abort = new AbortController()
      const signal = abort.signal
      const poll = async () => {
        try {
          const result = await callRuntimeRpc<{ pngBase64: string }>(
            { kind: 'local' },
            'emulator.screenshot',
            { device },
            { timeoutMs: 20000, signal }
          )
          if (active !== streamId) {
            return
          }
          if (typeof result.pngBase64 !== 'string' || result.pngBase64.length > 8 * 1024 * 1024) {
            throw new Error('Invalid Android screenshot')
          }
          const bytes = Uint8Array.from(atob(result.pngBase64), (character) =>
            character.charCodeAt(0)
          )
          if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
            throw new Error('Invalid Android screenshot')
          }
          for (const callback of frames) {
            callback({ streamId, bytes: bytes.buffer })
          }
          if (active === streamId) {
            timer = setTimeout(() => void poll(), 500)
          }
        } catch (error) {
          if (active !== streamId) {
            return
          }
          active = null
          for (const callback of errors) {
            callback({
              streamId,
              message: error instanceof Error ? error.message : 'Android preview disconnected'
            })
          }
        }
      }
      timer = setTimeout(() => void poll(), 0)
      return { streamId }
    },
    async stopFrameStream({ streamId }: { streamId: string }) {
      if (active !== streamId) {
        return
      }
      active = null
      clearTimeout(timer)
      abort?.abort()
    }
  }
}
