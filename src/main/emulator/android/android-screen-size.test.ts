import { describe, expect, it, vi } from 'vitest'
import type { AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import { readAndroidScreenSize } from './android-screen-size'

const SDK: AndroidSdkPaths = {
  sdkRoot: '/sdk',
  adb: '/sdk/adb',
  emulator: '/sdk/emulator',
  avdmanager: '/sdk/avdmanager'
}

describe('readAndroidScreenSize', () => {
  it('prefers the rotated logical input viewport over the physical panel size', async () => {
    const runner = vi.fn<AndroidCommandRunner>(async (_binary, args) => ({
      code: 0,
      stderr: '',
      stdout: args.includes('dumpsys')
        ? 'Viewport INTERNAL: orientation=1, deviceSize=[768, 1280], isActive=[1]'
        : 'Physical size: 1280x768'
    }))

    await expect(readAndroidScreenSize(runner, SDK, 'waydroid')).resolves.toEqual({
      width: 768,
      height: 1280
    })
    expect(runner).toHaveBeenCalledTimes(1)
  })
})
