import type { EmulatorBridge } from './emulator-bridge'
import { EmulatorError } from './emulator-errors'
import type { EmulatorTargetOpts } from './backends/emulator-backend'

export async function captureEmulatorScreenshot(
  bridge: EmulatorBridge,
  opts?: EmulatorTargetOpts
): Promise<string> {
  const { backend, device } = await bridge.resolveTarget(opts)
  if (!backend.captureScreenshot) {
    throw new EmulatorError(
      'emulator_unsupported',
      `screenshots are not supported by the ${backend.kind} emulator backend`
    )
  }
  return backend.captureScreenshot(device)
}
