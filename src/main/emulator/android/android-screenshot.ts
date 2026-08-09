import { execFile } from 'node:child_process'
import type { AndroidSdkPaths } from './android-sdk-discovery'

export function captureAndroidScreenshot(sdk: AndroidSdkPaths, serial: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      sdk.adb,
      ['-s', serial, 'exec-out', 'screencap', '-p'],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          reject(error)
        } else {
          resolve(Buffer.from(stdout).toString('base64'))
        }
      }
    )
  })
}
