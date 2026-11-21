import type { DeviceScreenSize } from './android-input-mapping'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import type { AndroidCommandRunner } from './android-command-runner'
import {
  inputDisplaySizeArgs,
  parseActiveInputDisplaySize,
  parseWmSize,
  wmSizeArgs
} from './adb-devices'

export async function readAndroidScreenSize(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  serial: string
): Promise<DeviceScreenSize | null> {
  const input = await runner(sdk.adb, inputDisplaySizeArgs(serial)).catch(() => null)
  const logicalSize = input?.code === 0 ? parseActiveInputDisplaySize(input.stdout) : null
  if (logicalSize) {
    return logicalSize
  }
  return readAndroidNaturalSize(runner, sdk, serial)
}

export async function readAndroidNaturalSize(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  serial: string
): Promise<DeviceScreenSize | null> {
  const wm = await runner(sdk.adb, wmSizeArgs(serial)).catch(() => null)
  return wm?.code === 0 ? parseWmSize(wm.stdout) : null
}
