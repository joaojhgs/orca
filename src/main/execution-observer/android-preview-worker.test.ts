import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANDROID_PREVIEW_MAX_BASE64_CHARACTERS,
  AndroidPreviewApproval,
  type AndroidPreviewRequest
} from '../../shared/ssh-android-preview-contract'
import { isApprovedAndroidDevice, observeAndroidPreview } from './android-preview-worker'

const mocks = vi.hoisted(() => ({ run: vi.fn(), screenshot: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../emulator/android/android-sdk-host-discovery', () => ({
  discoverAndroidSdkFromHost: () => ({
    adb: '/adb',
    emulator: '/emulator',
    sdkRoot: '/',
    avdmanager: '/avdmanager'
  })
}))
vi.mock('../emulator/android/android-screenshot', () => ({
  captureAndroidScreenshot: mocks.screenshot
}))
const approval = AndroidPreviewApproval.parse({ usb: true, emulators: true })
beforeEach(() => {
  mocks.run.mockReset().mockResolvedValue({
    code: 0,
    stdout:
      'List of devices attached\nUSB123 device model:Phone\nemulator-5554 device\n192.168.1.10:5555 device\nadb-wifi._adb-tls-connect._tcp device\n',
    stderr: '',
    timedOut: false
  })
  mocks.screenshot.mockReset().mockResolvedValue('iVBORw==')
})
describe('execution-host Android preview', () => {
  it('lists only approved devices and never scans/connects/pairs', async () => {
    const result = await observeAndroidPreview({
      operation: 'android-preview',
      approval,
      action: { kind: 'list' }
    })
    expect('devices' in result && result.devices?.map((device) => device.serial)).toEqual([
      'USB123',
      'emulator-5554'
    ])
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.run.mock.calls[0][0].args).toEqual(['devices', '-l'])
  })
  it('requires explicit approval for a network/Waydroid serial', () => {
    const device = { serial: '192.168.240.112:5555', state: 'device', isEmulator: false }
    expect(isApprovedAndroidDevice(device, approval)).toBe(false)
    expect(isApprovedAndroidDevice(device, { ...approval, serials: [device.serial] })).toBe(true)
  })
  it('rechecks authorization before screenshots and input', async () => {
    await expect(
      observeAndroidPreview({
        operation: 'android-preview',
        approval,
        action: { kind: 'screenshot', serial: '192.168.1.10:5555' }
      })
    ).rejects.toThrow(/not connected/)
    expect(mocks.screenshot).not.toHaveBeenCalled()
    await expect(
      observeAndroidPreview({
        operation: 'android-preview',
        approval,
        action: { kind: 'screenshot', serial: 'USB123' }
      })
    ).resolves.toEqual({ pngBase64: 'iVBORw==' })
    expect(mocks.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ adb: '/adb' }),
      'USB123'
    )
  })
  it('reports inventory timeout as unverifiable, not an empty device list', async () => {
    mocks.run.mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: true })
    const request: AndroidPreviewRequest = {
      operation: 'android-preview',
      approval,
      action: { kind: 'list' }
    }
    await expect(observeAndroidPreview(request)).rejects.toThrow(/unverifiable/)
  })
  it('rejects oversized screenshots before the encrypted transport drops the reply', async () => {
    mocks.screenshot.mockResolvedValue('A'.repeat(ANDROID_PREVIEW_MAX_BASE64_CHARACTERS + 1))
    await expect(
      observeAndroidPreview({
        operation: 'android-preview',
        approval,
        action: { kind: 'screenshot', serial: 'USB123' }
      })
    ).rejects.toThrow(/too large/)
  })
})
