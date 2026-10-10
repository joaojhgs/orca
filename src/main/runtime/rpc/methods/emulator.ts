import { defineMethod } from '../core'
import path from 'node:path'
import { z } from 'zod'
import { compactAgentDeviceScreenshot } from '../../../computer/agent-device-screenshot'
import { listSshAndroidDevices } from '../../../emulator/ssh-android-preview'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  AttachParams,
  AxParams,
  ButtonParams,
  EmulatorAvailabilityParams,
  EmulatorListDevicesParams,
  EmulatorListSimulatorsParams,
  EmulatorUnregisterActiveParams,
  ExecParams,
  GestureParams,
  KillParams,
  LaunchParams,
  ListParams,
  LogcatParams,
  PermissionsParams,
  RotateParams,
  ShutdownParams,
  TapParams,
  TypeParams
} from '../../../../shared/rpc-contract/emulator-params'

const InstallParams = z.object({
  path: z.string().refine((value) => path.isAbsolute(value), {
    message: 'path must be absolute'
  }),
  reinstall: z.boolean().optional(),
  device: z.string().optional(),
  emulator: z.string().optional(),
  worktree: z.string().optional()
})

async function androidOr<T>(
  runtime: OrcaRuntimeService,
  method: string,
  params: Parameters<OrcaRuntimeService['emulatorSshPreview']>[1],
  fallback: () => Promise<T>
) {
  const remote = await runtime.emulatorSshPreview(method, params)
  return remote.handled ? remote.result : fallback()
}

export const EMULATOR_METHODS = [
  defineMethod({
    name: 'emulator.agentScreenshot',
    permission: 'workspace',
    params: AxParams,
    handler: async (params, { runtime }) => {
      const captured = await androidOr(runtime, 'emulator.screenshot', params, () =>
        runtime.emulatorScreenshot(params)
      )
      if (
        !captured ||
        typeof captured !== 'object' ||
        !('pngBase64' in captured) ||
        typeof captured.pngBase64 !== 'string'
      ) {
        throw new Error('Device screenshot was not returned')
      }
      return compactAgentDeviceScreenshot(captured.pngBase64)
    }
  }),
  defineMethod({
    name: 'emulator.list',
    permission: 'workspace',
    params: ListParams,
    handler: async (params, { runtime }) => runtime.emulatorList(params)
  }),
  defineMethod({
    name: 'emulator.attach',
    permission: 'workspace',
    params: AttachParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.attach', params, () => runtime.emulatorAttach(params))
  }),
  defineMethod({
    name: 'emulator.tap',
    permission: 'workspace',
    params: TapParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.tap', params, () => runtime.emulatorTap(params))
  }),
  defineMethod({
    name: 'emulator.gesture',
    permission: 'workspace',
    params: GestureParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.gesture', params, () => runtime.emulatorGesture(params))
  }),
  defineMethod({
    name: 'emulator.type',
    permission: 'workspace',
    params: TypeParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.type', params, () => runtime.emulatorType(params))
  }),
  defineMethod({
    name: 'emulator.button',
    permission: 'workspace',
    params: ButtonParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.button', params, () => runtime.emulatorButton(params))
  }),
  defineMethod({
    name: 'emulator.rotate',
    permission: 'workspace',
    params: RotateParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.rotate', params, () => runtime.emulatorRotate(params))
  }),
  defineMethod({
    name: 'emulator.exec',
    permission: 'workspace',
    params: ExecParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.exec', params, () => runtime.emulatorExec(params))
  }),
  defineMethod({
    name: 'emulator.screenshot',
    permission: 'workspace',
    params: AxParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.screenshot', params, () => runtime.emulatorScreenshot(params))
  }),
  defineMethod({
    name: 'emulator.kill',
    permission: 'workspace',
    params: KillParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.kill', params, () => runtime.emulatorKill(params))
  }),
  defineMethod({
    name: 'emulator.shutdown',
    permission: 'workspace',
    params: ShutdownParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.shutdown', params, () => runtime.emulatorShutdown(params))
  }),
  defineMethod({
    name: 'emulator.listSimulators',
    permission: 'workspace',
    params: EmulatorListSimulatorsParams,
    handler: async (params, { runtime }) => runtime.emulatorListSimulators(params)
  }),
  defineMethod({
    name: 'emulator.availability',
    permission: 'workspace',
    params: EmulatorAvailabilityParams,
    handler: async (params, { runtime }) => runtime.emulatorAvailability(params)
  }),
  defineMethod({
    name: 'emulator.listDevices',
    permission: 'workspace',
    params: EmulatorListDevicesParams,
    handler: async (params, { runtime }) => {
      if (!params.executionHosts) {
        return runtime.emulatorListDevices(params)
      }
      const remote = await listSshAndroidDevices()
      const local = await runtime.emulatorListDevices(params).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'emulator_no_active') {
          return []
        }
        throw error
      })
      return [...local, ...remote]
    }
  }),
  defineMethod({
    name: 'emulator.install',
    permission: 'workspace',
    params: InstallParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.install', params, () => runtime.emulatorInstall(params))
  }),
  defineMethod({
    name: 'emulator.launch',
    permission: 'workspace',
    params: LaunchParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.launch', params, () => runtime.emulatorLaunch(params))
  }),
  defineMethod({
    name: 'emulator.permissions',
    permission: 'workspace',
    params: PermissionsParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.permissions', params, () => runtime.emulatorPermissions(params))
  }),
  defineMethod({
    name: 'emulator.ax',
    permission: 'workspace',
    params: AxParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.ax', params, () => runtime.emulatorAx(params))
  }),
  defineMethod({
    name: 'emulator.logcat',
    permission: 'workspace',
    params: LogcatParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.logcat', params, () => runtime.emulatorLogcat(params))
  }),
  defineMethod({
    name: 'emulator.unregisterActive',
    permission: 'workspace',
    params: EmulatorUnregisterActiveParams,
    handler: async (params, { runtime }) =>
      androidOr(runtime, 'emulator.unregisterActive', params, () =>
        runtime.emulatorUnregisterActive(params)
      )
  })
]
