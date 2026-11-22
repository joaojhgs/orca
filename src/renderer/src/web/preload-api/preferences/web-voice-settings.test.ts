import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getDefaultSettings,
  getDefaultVoiceSettings
} from '../../../../../shared/orca-profiles/constants'
import { VoiceServerSettingsUpdate } from '../../../../../shared/speech/voice-server-settings'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from '../../testing/web-preload-api-test-harness'
import { readStoredWebRuntimeEnvironment } from '../../pairing/web-runtime-environment'
import { followHostVoiceSettings, syncHostVoiceSettings } from './web-voice-settings'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('./web-native-chat-settings', () => ({ call }))

beforeEach(() => {
  call.mockReset()
  const globals = installBrowserGlobals('Linux')
  writeStoredRuntimeEnvironment(globals.storage)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
})
afterEach(() => vi.unstubAllGlobals())

it('uses server inference settings while preserving this browser’s microphone and recording controls', () => {
  const local = getDefaultSettings('/client')
  local.voice = {
    ...getDefaultVoiceSettings(),
    microphoneDeviceId: 'browser-mic',
    dictationMode: 'hold'
  }
  const result = followHostVoiceSettings(local, {
    voice: {
      ...getDefaultVoiceSettings(),
      enabled: true,
      sttModel: 'whisper-tiny',
      dictationLanguage: 'pt',
      microphoneDeviceId: 'server-mic',
      dictationMode: 'toggle'
    }
  })
  expect(result.voice).toMatchObject({
    enabled: true,
    sttModel: 'whisper-tiny',
    dictationLanguage: 'pt',
    microphoneDeviceId: 'browser-mic',
    dictationMode: 'hold'
  })
})

it('saves only changed inference fields to the selected server and keeps microphone changes local', async () => {
  const environment = readStoredWebRuntimeEnvironment()
  if (!environment) {
    throw new Error('Missing paired environment')
  }
  const previous = getDefaultSettings('/client')
  previous.voice = { ...getDefaultVoiceSettings(), enabled: true }
  call.mockResolvedValue({
    voice: { ...previous.voice, sttModel: 'whisper-tiny', dictationLanguage: 'pt' }
  })
  const result = await syncHostVoiceSettings(
    {
      voice: {
        ...previous.voice,
        sttModel: 'whisper-tiny',
        dictationLanguage: 'pt',
        microphoneDeviceId: 'browser-mic'
      }
    },
    previous,
    environment
  )
  expect(call).toHaveBeenCalledWith(environment, 'speech.settings.update', {
    sttModel: 'whisper-tiny',
    dictationLanguage: 'pt'
  })
  expect(result.voice).toMatchObject({
    sttModel: 'whisper-tiny',
    dictationLanguage: 'pt',
    microphoneDeviceId: 'browser-mic'
  })
  call.mockRejectedValueOnce(new Error('connection lost'))
  await expect(
    syncHostVoiceSettings(
      { voice: { ...previous.voice, sttModel: 'whisper-tiny' } },
      previous,
      environment
    )
  ).rejects.toThrow('connection lost')
})

it('rejects host paths and credentials through the paired speech-settings endpoint', () => {
  expect(
    VoiceServerSettingsUpdate.safeParse({ sttModel: 'whisper-tiny', modelsDir: '/other/files' })
      .success
  ).toBe(false)
  expect(VoiceServerSettingsUpdate.safeParse({ apiKey: 'private' }).success).toBe(false)
  expect(VoiceServerSettingsUpdate.safeParse({ microphoneDeviceId: 'host-mic' }).success).toBe(
    false
  )
})
