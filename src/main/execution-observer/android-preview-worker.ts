import { runProcess } from '../../shared/child-process/run-process'
import {
  ANDROID_PREVIEW_MAX_BASE64_CHARACTERS,
  type AndroidPreviewApproval,
  type AndroidPreviewRequest
} from '../../shared/ssh-android-preview-contract'
import { discoverAndroidSdkFromHost } from '../emulator/android/android-sdk-host-discovery'
import { parseAdbDevices, type AndroidAdbDevice } from '../emulator/android/adb-devices'
import type { AndroidCommandRunner } from '../emulator/android/android-command-runner'
import {
  androidButton,
  androidRotate,
  androidSwipe,
  androidTap,
  androidTypeText
} from '../emulator/android/android-input-commands'
import { readAndroidScreenSize } from '../emulator/android/android-screen-size'
import { androidNaturalOrientation } from '../emulator/android/android-input-mapping'
import { captureAndroidScreenshot } from '../emulator/android/android-screenshot'

export function isApprovedAndroidDevice(
  device: AndroidAdbDevice,
  approval: AndroidPreviewApproval
): boolean {
  if (approval.serials.includes(device.serial)) {
    return true
  }
  if (device.isEmulator) {
    return approval.emulators && /^emulator-\d{1,5}$/.test(device.serial)
  }
  // Network/mDNS serials cannot enter through the USB approval.
  return approval.usb && !/[:.]/.test(device.serial) && !device.serial.startsWith('adb-')
}

export async function observeAndroidPreview(request: AndroidPreviewRequest) {
  const sdk = discoverAndroidSdkFromHost()
  if (!sdk) {
    throw new Error('ADB is not installed on the execution host')
  }
  const runner: AndroidCommandRunner = async (binary, args, options) => {
    const result = await runProcess({
      program: binary,
      args,
      timeoutMs: options?.timeoutMs ?? 10000,
      maxOutputBytes: 256 * 1024
    })
    if (result.timedOut || result.outputTruncated) {
      throw new Error('ADB command is unverifiable')
    }
    return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 1 }
  }
  // No waydroid connect, adb connect/pair, mDNS lookup, or AVD boot during inventory.
  const inventory = await runner(sdk.adb, ['devices', '-l'])
  if (inventory.code !== 0) {
    throw new Error('ADB inventory is unverifiable')
  }
  const devices = parseAdbDevices(inventory.stdout).filter((device) =>
    isApprovedAndroidDevice(device, request.approval)
  )
  const action = request.action
  if (action.kind === 'list') {
    return {
      devices: devices.map((device) => ({
        serial: device.serial,
        label: device.model ?? device.serial,
        state:
          device.state === 'device'
            ? 'device'
            : device.state === 'unauthorized'
              ? 'unauthorized'
              : 'offline',
        isEmulator: device.isEmulator
      }))
    }
  }
  const device = devices.find((device) => device.serial === action.serial)
  if (!device || device.state !== 'device') {
    throw new Error('Approved Android device is not connected or authorized')
  }
  if (action.kind === 'screenshot') {
    const pngBase64 = await captureAndroidScreenshot(sdk, device.serial)
    if (pngBase64.length > ANDROID_PREVIEW_MAX_BASE64_CHARACTERS) {
      throw new Error('Android screenshot is too large')
    }
    return { pngBase64 }
  }
  if (action.kind === 'button') {
    await androidButton(runner, sdk, device.serial, action.name)
  } else if (action.kind === 'type') {
    await androidTypeText(runner, sdk, device.serial, action.text)
  } else {
    const size = await readAndroidScreenSize(runner, sdk, device.serial)
    if (!size) {
      throw new Error('Android display size is unavailable')
    }
    if (action.kind === 'tap') {
      await androidTap(runner, sdk, device.serial, action.x, action.y, size)
    } else if (action.kind === 'gesture') {
      await androidSwipe(runner, sdk, device.serial, action.points, size)
    } else {
      await androidRotate(
        runner,
        sdk,
        device.serial,
        action.orientation,
        androidNaturalOrientation(size)
      )
    }
  }
  return { ok: true as const }
}
