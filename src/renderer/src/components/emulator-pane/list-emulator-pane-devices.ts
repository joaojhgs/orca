import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { toSimulatorDeviceRows, type RawEmulatorDevice } from './emulator-device-row-mapping'

export async function listEmulatorPaneDevices() {
  const raw = await callRuntimeRpc<RawEmulatorDevice[]>({ kind: 'local' }, 'emulator.listDevices', {
    executionHosts: true
  })
  return toSimulatorDeviceRows(raw)
}
