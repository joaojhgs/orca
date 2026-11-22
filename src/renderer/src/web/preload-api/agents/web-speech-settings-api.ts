import type { SpeechApi } from '../../../../../preload/api/speech/speech-api'
import type { SpeechModelState } from '../../../../../shared/speech/speech-types'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { requireActiveEnvironmentOrNull } from '../../runtime/client/web-runtime-session'
import { callRuntimeResult } from '../../runtime/client/web-runtime-calls'

type SpeechSettingsApi = Pick<
  SpeechApi,
  | 'getCatalog'
  | 'getModelStates'
  | 'downloadModel'
  | 'cancelDownload'
  | 'deleteModel'
  | 'getOpenAiApiKeyStatus'
  | 'saveOpenAiApiKey'
  | 'clearOpenAiApiKey'
  | 'getOpenAiCompatibleProvider'
  | 'saveOpenAiCompatibleProvider'
  | 'clearOpenAiCompatibleProvider'
  | 'onDownloadProgress'
  | 'onReady'
>

export function createWebSpeechSettingsApi(): SpeechSettingsApi {
  const listeners = new Set<Parameters<SpeechApi['onDownloadProgress']>[0]>()
  let stopPolling: (() => void) | null = null
  let reading = false
  const reported = new Map<string, string>()
  let reportedOwner: string | undefined
  const getModelStates = () => callRuntimeResult<SpeechModelState[]>('speech.models.states')
  const reportDownloads = async (): Promise<void> => {
    if (reading) {
      return
    }
    reading = true
    const owner = requireActiveEnvironmentOrNull()?.id
    try {
      const states = await getModelStates()
      if (requireActiveEnvironmentOrNull()?.id !== owner) {
        return
      }
      if (reportedOwner !== owner) {
        reported.clear()
        reportedOwner = owner
      }
      for (const state of states) {
        const snapshot = JSON.stringify(state)
        if (reported.get(state.id) === snapshot) {
          continue
        }
        reported.set(state.id, snapshot)
        for (const listener of listeners) {
          listener({ modelId: state.id, progress: state.progress ?? 0 })
        }
      }
    } catch {
      // The model read in the pane reports a disconnected host; progress never fakes success.
    } finally {
      reading = false
    }
  }
  return {
    getCatalog: () => callRuntimeResult('speech.models.catalog'),
    getModelStates,
    getOpenAiApiKeyStatus: () => callRuntimeResult('speech.openAiKey.status'),
    saveOpenAiApiKey: (apiKey) => callRuntimeResult('speech.openAiKey.set', { apiKey }),
    clearOpenAiApiKey: () => callRuntimeResult('speech.openAiKey.clear'),
    getOpenAiCompatibleProvider: () => callRuntimeResult('speech.compatibleProvider.get'),
    saveOpenAiCompatibleProvider: (provider) =>
      callRuntimeResult('speech.compatibleProvider.set', provider),
    clearOpenAiCompatibleProvider: () => callRuntimeResult('speech.compatibleProvider.clear'),
    downloadModel: async (modelId) => {
      await callRuntimeResult('speech.models.download', { modelId })
      void reportDownloads()
    },
    cancelDownload: async (modelId) => {
      await callRuntimeResult('speech.models.cancelDownload', { modelId })
      void reportDownloads()
    },
    deleteModel: async (modelId) => {
      await callRuntimeResult('speech.models.delete', { modelId })
    },
    onDownloadProgress: (callback) => {
      listeners.add(callback)
      stopPolling ??= installWindowVisibilityInterval({
        run: () => void reportDownloads(),
        intervalMs: 2500
      })
      void reportDownloads()
      return () => {
        listeners.delete(callback)
        if (listeners.size === 0) {
          stopPolling?.()
          stopPolling = null
        }
      }
    },
    onReady: () => () => undefined
  }
}
