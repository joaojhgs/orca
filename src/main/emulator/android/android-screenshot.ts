import { spawnProcess } from '@orca/process-host'
import type { AndroidSdkPaths } from './android-sdk-discovery'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function extractPngFromAdbOutput(output: Buffer): Buffer {
  const signatureOffset = output.indexOf(PNG_SIGNATURE)
  if (signatureOffset === -1) {
    throw new Error('ADB screenshot output did not contain a PNG image.')
  }
  return signatureOffset === 0 ? output : output.subarray(signatureOffset)
}

export function captureAndroidScreenshot(sdk: AndroidSdkPaths, serial: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess({
      program: sdk.adb,
      args: ['-s', serial, 'exec-out', 'screencap', '-p']
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        chunks.length = 0
        reject(error)
      }
    }
    const timer = setTimeout(() => {
      fail(new Error('ADB screenshot timed out.'))
      child.kill()
    }, 10_000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }
      bytes += chunk.byteLength
      if (bytes > 16 * 1024 * 1024) {
        fail(new Error('ADB screenshot output exceeded the size limit.'))
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    child.stderr.resume()
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', fail)
    }
    child.stdin.end()
    child.on('error', fail)
    child.on('close', (code) => {
      if (settled) {
        return
      }
      if (code !== 0) {
        fail(new Error('ADB screenshot command failed.'))
        return
      }
      try {
        // Waydroid can prepend GPU warnings to the binary screencap payload.
        const image = extractPngFromAdbOutput(Buffer.concat(chunks)).toString('base64')
        settled = true
        clearTimeout(timer)
        resolve(image)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Invalid ADB screenshot output.'))
      }
    })
  })
}
