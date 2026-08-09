import { execFile } from 'node:child_process'
import type { AndroidSdkPaths } from './android-sdk-discovery'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function extractPngFromAdbOutput(output: Buffer): Buffer {
  const signatureOffset = output.indexOf(PNG_SIGNATURE)
  if (signatureOffset < 0) {
    throw new Error('ADB screenshot output did not contain a PNG image.')
  }
  return signatureOffset === 0 ? output : output.subarray(signatureOffset)
}

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
          // Waydroid can print vendor/GPU warnings to stdout before screencap's
          // binary payload. Start at the PNG signature so web clients receive
          // a decodable image rather than warning text followed by a PNG.
          try {
            resolve(extractPngFromAdbOutput(Buffer.from(stdout)).toString('base64'))
          } catch (cause) {
            reject(cause)
          }
        }
      }
    )
  })
}
