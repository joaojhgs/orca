import { useEffect, useMemo, useState } from 'react'
import { BROWSER_DESIGN_MODE_RUNTIME_CAPABILITY } from '../../../../../shared/protocol-version'
import type {
  BrowserSetGrabModeResult,
  BrowserGrabResult,
  BrowserCaptureSelectionScreenshotResult
} from '../../../../../shared/browser-grab-types'
import { callRuntimeRpc, runtimeEnvironmentSupportsCapability } from '@/runtime/runtime-rpc-client'
import { useGrabMode, type GrabModeTransport } from '../annotate/useGrabMode'
import { formatGrabPayloadAsText } from '../annotate/GrabConfirmationSheet'
import type { RemoteBrowserRuntimeTarget } from './remote-browser-page-input-model'

export function useRemoteBrowserPageGrab(args: {
  browserPageId: string
  environmentId: string
  worktree: string
  runtimeTarget: () => RemoteBrowserRuntimeTarget | null
  remotePage: () => string | null
}) {
  const { runtimeTarget, remotePage, worktree } = args
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    let cancelled = false
    setSupported(false)
    void runtimeEnvironmentSupportsCapability(
      args.environmentId,
      BROWSER_DESIGN_MODE_RUNTIME_CAPABILITY
    )
      .then((value) => {
        if (!cancelled) {
          setSupported(value)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [args.environmentId])

  const transport = useMemo((): GrabModeTransport => {
    function page() {
      const target = runtimeTarget()
      const page = remotePage()
      if (!target || !page) {
        throw new Error('Remote browser page is unavailable.')
      }
      return { target, params: { worktree, page } }
    }
    return {
      setGrabMode: async (enabled) => {
        try {
          const { target, params } = page()
          return await callRuntimeRpc<BrowserSetGrabModeResult>(target, 'browser.grab.setMode', {
            ...params,
            enabled
          })
        } catch {
          return { ok: false, reason: 'not-ready' }
        }
      },
      awaitGrabSelection: async (opId) => {
        try {
          const { target, params } = page()
          return await callRuntimeRpc<BrowserGrabResult>(
            target,
            'browser.grab.awaitSelection',
            { ...params, opId },
            { timeoutMs: 130_000 }
          )
        } catch (error) {
          return {
            opId,
            kind: 'error',
            reason: error instanceof Error ? error.message : 'Remote selection failed.'
          }
        }
      },
      cancelGrab: async () => {
        try {
          const { target, params } = page()
          return await callRuntimeRpc(target, 'browser.grab.cancel', params)
        } catch {
          return undefined
        }
      },
      captureSelectionScreenshot: async (rect) => {
        try {
          const { target, params } = page()
          return await callRuntimeRpc<BrowserCaptureSelectionScreenshotResult>(
            target,
            'browser.grab.captureScreenshot',
            { ...params, rect }
          )
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : 'Screenshot unavailable.'
          }
        }
      }
    }
  }, [runtimeTarget, remotePage, worktree])
  const grab = useGrabMode(`${args.environmentId}:${args.browserPageId}`, transport)
  const { state, payload, contextMenu, rearm } = grab
  useEffect(() => {
    if (state !== 'confirming' || !payload || contextMenu) {
      return
    }
    let cancelled = false
    void window.api.ui
      .writeClipboardText(formatGrabPayloadAsText(payload))
      .then(() => {
        if (!cancelled) {
          rearm()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [state, payload, contextMenu, rearm])
  return { grab, supported }
}
