import type { GlobalSettings } from '../../shared/settings/global-settings-types'

export type EmulatorHostSettings = Pick<
  GlobalSettings,
  'mobileEmulatorEnabled' | 'mobileEmulatorDefaultDeviceUdid' | 'androidSdkPath'
>

// Which emulator backend owns a device/session. Lives here (the low-level types
// file) so both the bridge types and the backend interface import it without a cycle.
export type EmulatorBackendKind = 'ios' | 'android'

export type EmulatorStreamCodec = 'mjpeg' | 'h264'

export type EmulatorSessionInfo = {
  deviceUdid: string
  wsUrl: string
  streamUrl: string
  axUrl?: string
  helperPid?: number
  streamCodec?: EmulatorStreamCodec
  backend?: EmulatorBackendKind
}

export type EmulatorActiveSession = EmulatorSessionInfo & {
  worktreeId: string
  backend: EmulatorBackendKind
}
