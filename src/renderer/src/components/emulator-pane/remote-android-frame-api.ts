import { callRuntimeRpc, hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import { createBrowserUuid } from '@/lib/browser-uuid'

type Frame = { streamId: string; bytes: ArrayBuffer }
type FrameError = { streamId: string; message: string }

export function createRemoteAndroidFrameApi(deviceId?: string, worktree?: string) {
  const frames = new Set<(frame: Frame) => void>()
  const errors = new Set<(error: FrameError) => void>()
  let active: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: AbortController | undefined
  let removeResumeListeners: (() => void) | undefined
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
      clearTimeout(timer)
      abort?.abort()
      removeResumeListeners?.()
      active = streamId
      abort = new AbortController()
      const signal = abort.signal
      let ticket = device
      let needsAttach = deviceId?.startsWith('ssh-adb:') === true
      let polling = false
      let fatal = false
      let failures = 0
      const reportError = (message: string) => {
        for (const callback of errors) {
          callback({ streamId, message })
        }
      }
      const poll = async () => {
        if (active !== streamId || polling || fatal || document.visibilityState === 'hidden') {
          return
        }
        polling = true
        try {
          if (needsAttach) {
            const attached = await callRuntimeRpc<{
              attached: boolean
              info?: { deviceUdid?: string; streamUrl?: string }
            }>(
              { kind: 'local' },
              'emulator.attach',
              {
                device: deviceId,
                previewStream: ticket,
                focus: false,
                ...(worktree ? { worktree } : {})
              },
              { timeoutMs: 20000, signal }
            )
            if (active !== streamId) {
              return
            }
            const renewedUrl = attached.info?.streamUrl
            if (
              !attached.attached ||
              attached.info?.deviceUdid !== deviceId ||
              !renewedUrl?.startsWith('remote-adb://ssh-adb-stream:')
            ) {
              fatal = true
              reportError('Invalid Android preview renewal')
              return
            }
            ticket = renewedUrl.slice('remote-adb://'.length)
            needsAttach = false
          }
          const result = await callRuntimeRpc<{ pngBase64: string }>(
            { kind: 'local' },
            'emulator.screenshot',
            { device: ticket },
            { timeoutMs: 20000, signal }
          )
          if (active !== streamId) {
            return
          }
          if (typeof result?.pngBase64 !== 'string' || result.pngBase64.length > 8 * 1024 * 1024) {
            fatal = true
            reportError('Invalid Android screenshot')
            return
          }
          let bytes: Uint8Array<ArrayBuffer>
          try {
            bytes = Uint8Array.from(atob(result.pngBase64), (character) => character.charCodeAt(0))
          } catch {
            fatal = true
            reportError('Invalid Android screenshot')
            return
          }
          if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
            fatal = true
            reportError('Invalid Android screenshot')
            return
          }
          for (const callback of frames) {
            callback({ streamId, bytes: bytes.buffer })
          }
          if (active === streamId) {
            failures = 0
            timer = setTimeout(() => void poll(), 500)
          }
        } catch (error) {
          if (active !== streamId) {
            return
          }
          reportError(error instanceof Error ? error.message : 'Android preview disconnected')
          if (
            ['unauthorized', 'forbidden', 'invalid_argument', 'method_not_found'].some((code) =>
              hasRuntimeRpcErrorCode(error, code)
            )
          ) {
            fatal = true
            return
          }
          needsAttach = deviceId?.startsWith('ssh-adb:') === true
          failures += 1
          if (failures <= 5) {
            timer = setTimeout(() => void poll(), Math.min(1000 * 2 ** (failures - 1), 10000))
          }
        } finally {
          polling = false
        }
      }
      const resume = () => {
        if (active !== streamId || polling || fatal || document.visibilityState === 'hidden') {
          return
        }
        clearTimeout(timer)
        failures = 0
        void poll()
      }
      document.addEventListener('visibilitychange', resume)
      window.addEventListener('online', resume)
      window.addEventListener('focus', resume)
      removeResumeListeners = () => {
        document.removeEventListener('visibilitychange', resume)
        window.removeEventListener('online', resume)
        window.removeEventListener('focus', resume)
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
      removeResumeListeners?.()
    }
  }
}
