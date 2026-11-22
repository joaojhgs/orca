import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import type { VoiceSettings } from '../../../../../shared/speech/speech-types'
import { getDefaultVoiceSettings } from '../../../../../shared/orca-profiles/constants'
import type { StoredWebRuntimeEnvironment } from '../../pairing/web-runtime-environment'
import { call } from './web-native-chat-settings'
import { VoiceServerSettingsSchema } from '../../../../../shared/speech/voice-server-settings'

const CLIENT_VOICE_KEYS = [
  'microphoneDeviceId',
  'microphoneDeviceLabel',
  'terminalConfirmBeforeInsert',
  'dictationMode',
  'dictationHoldToRecord',
  'stopAfterSilenceSeconds'
] as const satisfies readonly (keyof VoiceSettings)[]

export function followHostVoiceSettings(
  local: GlobalSettings,
  host: Partial<GlobalSettings>
): Partial<GlobalSettings> {
  if (!host.voice) {
    return {}
  }
  const client = local.voice ?? getDefaultVoiceSettings()
  const voice = { ...client, ...host.voice }
  for (const key of CLIENT_VOICE_KEYS) {
    Object.assign(voice, { [key]: client[key] })
  }
  voice.enabled =
    host.voice.enabled === true && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)
  return { voice }
}

export async function syncHostVoiceSettings(
  updates: Partial<GlobalSettings>,
  previous: GlobalSettings,
  environment: StoredWebRuntimeEnvironment
): Promise<Partial<GlobalSettings>> {
  if (!updates.voice) {
    return {}
  }
  const patch: Partial<VoiceSettings> = {}
  for (const key of VoiceServerSettingsSchema.keyof().options) {
    if (
      Object.hasOwn(updates.voice, key) &&
      JSON.stringify(updates.voice[key]) !== JSON.stringify(previous.voice?.[key])
    ) {
      Object.assign(patch, { [key]: updates.voice[key] })
    }
  }
  if (Object.keys(patch).length === 0) {
    return {}
  }
  const allowed = VoiceServerSettingsSchema.partial().parse(patch)
  if (Object.keys(allowed).length === 0) {
    return {}
  }
  const result = await call<{ voice: Partial<VoiceSettings> }>(
    environment,
    'speech.settings.update',
    allowed
  )
  const local = {
    ...previous,
    voice: { ...(previous.voice ?? getDefaultVoiceSettings()), ...updates.voice }
  }
  return followHostVoiceSettings(local, {
    voice: { ...getDefaultVoiceSettings(), ...result.voice }
  })
}

export async function readHostVoiceSettings(
  environment: StoredWebRuntimeEnvironment
): Promise<Partial<GlobalSettings>> {
  const result = await call<{ voice: Partial<VoiceSettings> }>(environment, 'speech.settings.get')
  return result.voice ? { voice: { ...getDefaultVoiceSettings(), ...result.voice } } : {}
}
