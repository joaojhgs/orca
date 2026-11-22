import { defineMethod } from '../../core'
import { VoiceServerSettingsUpdate } from '../../../../../shared/speech/voice-server-settings'
import {
  DictationChunk,
  DictationHandle,
  DictationSetup,
  DictationStart,
  CompatibleSpeechProviderSet,
  OpenAiSpeechKeySet,
  SpeechModelAction,
  SpeechSetupRead
} from '../../../../../shared/rpc-contract/speech/speech-params'
import { saveVerifiedOpenAiCompatibleSpeechProvider } from '../../../../speech/openai-api-key-verification'
import {
  clearOpenAiCompatibleSpeechProvider,
  summarizeOpenAiCompatibleSpeechProvider
} from '../../../../speech/openai-compatible-speech-provider-store'

export const SPEECH_METHODS = [
  defineMethod({
    name: 'speech.settings.get',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => runtime.getSpeechSettings()
  }),
  defineMethod({
    name: 'speech.settings.update',
    permission: 'settings-write',
    params: VoiceServerSettingsUpdate,
    handler: (params, { runtime }) => runtime.updateSpeechSettings(params)
  }),
  defineMethod({
    name: 'speech.models.catalog',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => runtime.getSpeechCatalog()
  }),
  defineMethod({
    name: 'speech.models.states',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => runtime.getSpeechModelStates()
  }),
  defineMethod({
    name: 'speech.models.cancelDownload',
    permission: 'settings-write',
    params: SpeechModelAction,
    handler: (params, { runtime }) => runtime.cancelSpeechModelDownload(params.modelId)
  }),
  defineMethod({
    name: 'speech.compatibleProvider.get',
    permission: 'workspace',
    params: null,
    handler: () => summarizeOpenAiCompatibleSpeechProvider()
  }),
  defineMethod({
    name: 'speech.compatibleProvider.set',
    permission: 'settings-write',
    params: CompatibleSpeechProviderSet,
    handler: (params) => saveVerifiedOpenAiCompatibleSpeechProvider(params)
  }),
  defineMethod({
    name: 'speech.compatibleProvider.clear',
    permission: 'settings-write',
    params: null,
    handler: () => clearOpenAiCompatibleSpeechProvider()
  }),
  defineMethod({
    name: 'speech.models.list',
    permission: 'workspace',
    params: SpeechSetupRead,
    handler: async (params, { runtime }) => runtime.listMobileSpeechModels(params?.worktreeId)
  }),
  defineMethod({
    name: 'speech.models.download',
    permission: 'workspace',
    params: SpeechModelAction,
    handler: async (params, { runtime }) => runtime.downloadMobileSpeechModel(params.modelId)
  }),
  defineMethod({
    name: 'speech.models.delete',
    permission: 'workspace',
    params: SpeechModelAction,
    handler: async (params, { runtime }) => runtime.deleteMobileSpeechModel(params.modelId)
  }),
  defineMethod({
    name: 'speech.dictation.setup',
    permission: 'workspace',
    params: DictationSetup,
    handler: async (params, { runtime }) =>
      runtime.configureMobileDictation({
        ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
        ...(params.modelId !== undefined ? { modelId: params.modelId } : {}),
        ...(params.dictationMode !== undefined ? { dictationMode: params.dictationMode } : {}),
        ...(params.dictationHoldToRecord !== undefined
          ? { dictationHoldToRecord: params.dictationHoldToRecord }
          : {})
      })
  }),
  defineMethod({
    name: 'speech.dictation.start',
    permission: 'workspace',
    params: DictationStart,
    handler: async (params, { runtime, clientId }) =>
      runtime.startMobileDictation({ ...params, clientId })
  }),
  defineMethod({
    name: 'speech.dictation.chunk',
    permission: 'workspace',
    params: DictationChunk,
    handler: (params, { runtime, clientId }) => runtime.feedMobileDictation({ ...params, clientId })
  }),
  defineMethod({
    name: 'speech.dictation.finish',
    permission: 'workspace',
    params: DictationHandle,
    handler: async (params, { runtime, clientId }) =>
      runtime.finishMobileDictation({ ...params, clientId })
  }),
  defineMethod({
    name: 'speech.dictation.cancel',
    permission: 'workspace',
    params: DictationHandle,
    handler: async (params, { runtime, clientId }) =>
      runtime.cancelMobileDictation({ ...params, clientId })
  }),
  defineMethod({
    name: 'speech.openAiKey.status',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.getOpenAiSpeechKeyStatus()
  }),
  defineMethod({
    name: 'speech.openAiKey.set',
    permission: 'settings-write',
    params: OpenAiSpeechKeySet,
    handler: async (params, { runtime }) => runtime.setOpenAiSpeechKey(params.apiKey)
  }),
  defineMethod({
    name: 'speech.openAiKey.clear',
    permission: 'settings-write',
    params: null,
    handler: async (_params, { runtime }) => runtime.clearOpenAiSpeechKey()
  })
]
