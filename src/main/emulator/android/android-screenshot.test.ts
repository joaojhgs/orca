import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import { captureAndroidScreenshot, extractPngFromAdbOutput } from './android-screenshot'

vi.mock('@orca/process-host', () => ({ spawnProcess: vi.fn() }))

afterEach(() => vi.mocked(spawnProcess).mockReset())

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('extractPngFromAdbOutput', () => {
  it('keeps a clean screencap payload intact', () => {
    expect(extractPngFromAdbOutput(PNG)).toEqual(PNG)
  })

  it('removes Waydroid vendor warnings before the PNG signature', () => {
    const output = Buffer.concat([
      Buffer.from('/vendor/etc/hwdata/amdgpu.ids: No such file or directory\n'),
      PNG
    ])

    expect(extractPngFromAdbOutput(output)).toEqual(PNG)
  })

  it('rejects output without a PNG payload', () => {
    expect(() => extractPngFromAdbOutput(Buffer.from('adb failure'))).toThrow(
      'did not contain a PNG image'
    )
  })
})

describe('captureAndroidScreenshot', () => {
  const sdk = { sdkRoot: '/sdk', adb: '/sdk/adb', emulator: '', avdmanager: '' }

  it('captures binary PNG through the host process API and removes vendor warnings', async () => {
    const payload = Buffer.concat([Buffer.from('GPU warning\n'), PNG]).toString('base64')
    vi.mocked(spawnProcess).mockImplementation(() =>
      spawn(process.execPath, ['-e', `process.stdout.write(Buffer.from('${payload}', 'base64'))`])
    )

    await expect(captureAndroidScreenshot(sdk, 'waydroid')).resolves.toBe(PNG.toString('base64'))
    expect(spawnProcess).toHaveBeenCalledWith({
      program: '/sdk/adb',
      args: ['-s', 'waydroid', 'exec-out', 'screencap', '-p']
    })
  })

  it('rejects a failed capture without returning partial output', async () => {
    vi.mocked(spawnProcess).mockImplementation(() =>
      spawn(process.execPath, ['-e', 'process.exit(2)'])
    )

    await expect(captureAndroidScreenshot(sdk, 'waydroid')).rejects.toThrow('command failed')
  })

  it('bounds captured binary output', async () => {
    vi.mocked(spawnProcess).mockImplementation(() =>
      spawn(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(17 * 1024 * 1024))'])
    )

    await expect(captureAndroidScreenshot(sdk, 'waydroid')).rejects.toThrow('size limit')
  })
})
