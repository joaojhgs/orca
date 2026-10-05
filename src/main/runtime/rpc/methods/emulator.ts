import { defineMethod } from '../core'
import path from 'node:path'
import { z } from 'zod'
import {
  dispatchSshAndroidPreview,
  listSshAndroidDevices
} from '../../../emulator/ssh-android-preview'
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
  method: string,
  params: Parameters<typeof dispatchSshAndroidPreview>[1],
  fallback: () => Promise<T>
) {
  const remote = await dispatchSshAndroidPreview(method, params)
  return remote.handled ? remote.result : fallback()
}

export const EMULATOR_METHODS = [
  defineMethod({
    name: 'emulator.list',
    params: ListParams,
    handler: async (params, { runtime }) => runtime.emulatorList(params)
  }),
  defineMethod({
    name: 'emulator.attach',
    params: AttachParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.attach', params, () => runtime.emulatorAttach(params))
  }),
  defineMethod({
    name: 'emulator.tap',
    params: TapParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.tap', params, () => runtime.emulatorTap(params))
  }),
  defineMethod({
    name: 'emulator.gesture',
    params: GestureParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.gesture', params, () => runtime.emulatorGesture(params))
  }),
  defineMethod({
    name: 'emulator.type',
    params: TypeParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.type', params, () => runtime.emulatorType(params))
  }),
  defineMethod({
    name: 'emulator.button',
    params: ButtonParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.button', params, () => runtime.emulatorButton(params))
  }),
  defineMethod({
    name: 'emulator.rotate',
    params: RotateParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.rotate', params, () => runtime.emulatorRotate(params))
  }),
  defineMethod({
    name: 'emulator.exec',
    params: ExecParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.exec', params, () => runtime.emulatorExec(params))
  }),
  defineMethod({
    name: 'emulator.screenshot',
    params: AxParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.screenshot', params, () => runtime.emulatorScreenshot(params))
  }),
  defineMethod({
    name: 'emulator.kill',
    params: KillParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.kill', params, () => runtime.emulatorKill(params))
  }),
  defineMethod({
    name: 'emulator.shutdown',
    params: ShutdownParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.shutdown', params, () => runtime.emulatorShutdown(params))
  }),
  defineMethod({
    name: 'emulator.listSimulators',
    params: EmulatorListSimulatorsParams,
    handler: async (params, { runtime }) => runtime.emulatorListSimulators(params)
  }),
  defineMethod({
    name: 'emulator.availability',
    params: EmulatorAvailabilityParams,
    handler: async (params, { runtime }) => runtime.emulatorAvailability(params)
  }),
  defineMethod({
    name: 'emulator.listDevices',
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
    params: InstallParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.install', params, () => runtime.emulatorInstall(params))
  }),
  defineMethod({
    name: 'emulator.launch',
    params: LaunchParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.launch', params, () => runtime.emulatorLaunch(params))
  }),
  defineMethod({
    name: 'emulator.permissions',
    params: PermissionsParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.permissions', params, () => runtime.emulatorPermissions(params))
  }),
  defineMethod({
    name: 'emulator.ax',
    params: AxParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.ax', params, () => runtime.emulatorAx(params))
  }),
  defineMethod({
    name: 'emulator.logcat',
    params: LogcatParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.logcat', params, () => runtime.emulatorLogcat(params))
  }),
  defineMethod({
    name: 'emulator.unregisterActive',
    params: EmulatorUnregisterActiveParams,
    handler: async (params, { runtime }) =>
      androidOr('emulator.unregisterActive', params, () => runtime.emulatorUnregisterActive(params))
  })
]
