import type { PreloadApi } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { noopUnsubscribe } from './web-storage'
import { callRuntimeResult } from './web-runtime-calls'

export function createBrowserApi(): NonNullable<Partial<PreloadApi>['browser']> {
  return {
    registerGuest: () => Promise.resolve(false),
    isGuestRegistered: () => Promise.resolve(false),
    repairGuestRegistration: () => Promise.resolve(false),
    unregisterGuest: () => Promise.resolve(),
    openDevTools: () => Promise.resolve(false),
    setViewportOverride: () => Promise.resolve(false),
    reportViewportScrollState: () => {},
    setAnnotationViewportBridge: () => Promise.resolve(false),
    // A web client never hosts pages, so it has no lease to publish over.
    publishClientPageMetadata: () => Promise.resolve({ status: 'refused' as const }),
    onGuestLoadFailed: () => noopUnsubscribe,
    onCertificateFailureChanged: () => noopUnsubscribe,
    proceedCertificate: () => Promise.resolve({ ok: false, reason: 'missing' }),
    onPermissionDenied: () => noopUnsubscribe,
    onPopup: () => noopUnsubscribe,
    onDownloadRequested: () => noopUnsubscribe,
    onDownloadProgress: () => noopUnsubscribe,
    onDownloadFinished: () => noopUnsubscribe,
    onContextMenuRequested: () => noopUnsubscribe,
    onContextMenuDismissed: () => noopUnsubscribe,
    onNavigationUpdate: () => noopUnsubscribe,
    onActivateView: () => noopUnsubscribe,
    onPaneFocus: () => noopUnsubscribe,
    onOpenLinkInOrcaTab: () => noopUnsubscribe,
    cancelDownload: () => Promise.resolve(false),
    setGrabMode: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.31bea294d5',
          'Grab mode is unavailable in the web client.'
        )
      }),
    awaitGrabSelection: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.31bea294d5',
          'Grab mode is unavailable in the web client.'
        )
      }),
    cancelGrab: () => Promise.resolve(false),
    captureSelectionScreenshot: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.8dfcb7a351',
          'Selection screenshots are unavailable in the web client.'
        )
      }),
    extractHoverPayload: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.275a776357',
          'Hover extraction is unavailable in the web client.'
        )
      }),
    onGrabModeToggle: () => noopUnsubscribe,
    onGrabActionShortcut: () => noopUnsubscribe,
    sessionListProfiles: () => Promise.resolve([]),
    // Web clients render remote workspaces through the server; no local SSH routing exists.
    prepareSshWorkspacePartition: () =>
      Promise.reject(new Error('browser_local_route_unavailable')),
    sessionCreateProfile: () => Promise.resolve(null),
    sessionDeleteProfile: () => Promise.resolve(false),
    sessionImportCookies: () =>
      Promise.resolve({
        ok: false,
        summary: null,
        error: translate(
          'auto.web.web.preload.api.67ec964791',
          'Cookie import is unavailable in the web client.'
        )
      }),
    sessionResolvePartition: () => Promise.resolve(null),
    sessionDetectBrowsers: () => Promise.resolve([]),
    sessionDetectBrowsersForClientHost: () => Promise.resolve(null),
    sessionImportFromBrowserForClientHost: () => Promise.resolve(null),
    sessionClientRouteImportSources: () => Promise.resolve({}),
    sessionImportFromBrowser: () =>
      Promise.resolve({
        ok: false,
        summary: null,
        error: translate(
          'auto.web.web.preload.api.67ec964791',
          'Cookie import is unavailable in the web client.'
        )
      }),
    sessionClearDefaultCookies: () => Promise.resolve(false),
    notifyActiveTabChanged: () => Promise.resolve(false)
  } as unknown as NonNullable<Partial<PreloadApi>['browser']>
}

export function createEmulatorApi(): NonNullable<Partial<PreloadApi>['emulator']> {
  type Frame = { streamId: string; bytes: ArrayBuffer }
  type StreamError = { streamId: string; message: string }
  const frameListeners = new Set<(frame: Frame) => void>()
  const errorListeners = new Set<(error: StreamError) => void>()
  const streamTimers = new Map<string, number>()

  const stopFrameStream = ({ streamId }: { streamId: string }): Promise<void> => {
    const timer = streamTimers.get(streamId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
    streamTimers.delete(streamId)
    return Promise.resolve()
  }

  return {
    onPaneFocus: () => noopUnsubscribe,
    onAutoAttach: () => noopUnsubscribe,
    startFrameStream: async ({ streamUrl }: { streamUrl: string }) => {
      if (!streamUrl.startsWith('scrcpy://')) {
        throw new Error('This remote emulator stream is not supported in the web client.')
      }
      const device = streamUrl.slice('scrcpy://'.length)
      const streamId = `web-emulator-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const poll = async (): Promise<void> => {
        if (!streamTimers.has(streamId)) {
          return
        }
        try {
          const result = await callRuntimeResult<{ pngBase64: string }>(
            'emulator.screenshot',
            { device },
            12_000
          )
          if (!streamTimers.has(streamId)) {
            return
          }
          const binary = atob(result.pngBase64)
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
          for (const listener of frameListeners) {
            listener({ streamId, bytes })
          }
        } catch (error) {
          if (!streamTimers.has(streamId)) {
            return
          }
          const message = error instanceof Error ? error.message : 'Emulator stream disconnected'
          for (const listener of errorListeners) {
            listener({ streamId, message })
          }
        }
        if (streamTimers.has(streamId)) {
          streamTimers.set(
            streamId,
            window.setTimeout(() => void poll(), 75)
          )
        }
      }
      streamTimers.set(
        streamId,
        window.setTimeout(() => void poll(), 0)
      )
      return { streamId }
    },
    stopFrameStream,
    onFrameStreamFrame: (callback: (frame: Frame) => void) => {
      frameListeners.add(callback)
      return () => frameListeners.delete(callback)
    },
    onFrameStreamError: (callback: (error: StreamError) => void) => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    },
    startVideoStream: () =>
      Promise.reject(new Error('Video streaming is unavailable on web; use the frame stream.')),
    stopVideoStream: () => Promise.resolve(),
    onVideoStreamMeta: () => noopUnsubscribe,
    onVideoStreamFrame: () => noopUnsubscribe
  }
}
