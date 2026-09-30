import {
  callComputerSidecarAction,
  callComputerSidecarCapabilities,
  callComputerSidecarListApps,
  callComputerSidecarListWindows,
  callComputerSidecarSnapshot,
  resetComputerSidecarForTest
} from '../../../computer/sidecar-client'
import { defineMethod } from '../core'
import { mintDesktopVncTicket } from '../../../computer/desktop-vnc-tickets'
import {
  listDesktopVncTargets,
  readDesktopVncTargetPassword,
  resolveDesktopVncTarget
} from '../../../computer/desktop-vnc-targets'
import {
  Click,
  ComputerObserveTarget,
  ComputerPermissions,
  Drag,
  Hotkey,
  ListApps,
  ListWindows,
  PasteText,
  PerformSecondaryAction,
  PressKey,
  Scroll,
  SetValue,
  TypeText
} from './computer-schemas'
import {
  ComputerCapabilitiesParams,
  ComputerDesktopStreamTicketParams,
  ComputerDesktopTargetsParams,
  ComputerPermissionsStatusParams
} from '../../../../shared/rpc-contract/computer-params'

export function resetComputerSessionsForTest(): void {
  resetComputerSidecarForTest()
}

export const COMPUTER_METHODS = [
  defineMethod({
    name: 'computer.desktopStreamTicket',
    params: ComputerDesktopStreamTicketParams,
    handler: async (params) => {
      const target = resolveDesktopVncTarget(params.desktopId)
      const password = readDesktopVncTargetPassword(target)
      const ticket = mintDesktopVncTicket(
        { id: target.id, port: target.port, viewOnly: target.viewOnly },
        Date.now()
      )
      return {
        path: `/desktop-vnc?ticket=${encodeURIComponent(ticket)}`,
        desktopId: target.id,
        viewOnly: target.viewOnly,
        ...(password ? { credentials: { password } } : {})
      }
    }
  }),
  defineMethod({
    name: 'computer.desktopTargets',
    params: ComputerDesktopTargetsParams,
    handler: async () => ({ targets: listDesktopVncTargets() })
  }),
  defineMethod({
    name: 'computer.capabilities',
    params: ComputerCapabilitiesParams,
    handler: async () => {
      return await callComputerSidecarCapabilities()
    }
  }),
  defineMethod({
    name: 'computer.listApps',
    params: ListApps,
    handler: async () => {
      return await callComputerSidecarListApps()
    }
  }),
  defineMethod({
    name: 'computer.permissions',
    params: ComputerPermissions,
    handler: async (params) => {
      const { openComputerUsePermissions } =
        await import('../../../computer/macos-computer-use-permissions')
      return openComputerUsePermissions(params.id)
    }
  }),
  defineMethod({
    name: 'computer.permissionsStatus',
    params: ComputerPermissionsStatusParams,
    handler: async () => {
      const { getComputerUsePermissionStatus } =
        await import('../../../computer/macos-computer-use-permissions')
      return getComputerUsePermissionStatus()
    }
  }),
  defineMethod({
    name: 'computer.listWindows',
    params: ListWindows,
    handler: async (params) => {
      return await callComputerSidecarListWindows(params)
    }
  }),
  defineMethod({
    name: 'computer.getAppState',
    params: ComputerObserveTarget,
    handler: async (params) => {
      return await callComputerSidecarSnapshot(params)
    }
  }),
  defineMethod({
    name: 'computer.click',
    params: Click,
    handler: async (params) => {
      return await callComputerSidecarAction('click', params)
    }
  }),
  defineMethod({
    name: 'computer.performSecondaryAction',
    params: PerformSecondaryAction,
    handler: async (params) => {
      return await callComputerSidecarAction('performSecondaryAction', params)
    }
  }),
  defineMethod({
    name: 'computer.scroll',
    params: Scroll,
    handler: async (params) => {
      return await callComputerSidecarAction('scroll', params)
    }
  }),
  defineMethod({
    name: 'computer.drag',
    params: Drag,
    handler: async (params) => {
      return await callComputerSidecarAction('drag', params)
    }
  }),
  defineMethod({
    name: 'computer.typeText',
    params: TypeText,
    handler: async (params) => {
      return await callComputerSidecarAction('typeText', params)
    }
  }),
  defineMethod({
    name: 'computer.pressKey',
    params: PressKey,
    handler: async (params) => {
      return await callComputerSidecarAction('pressKey', params)
    }
  }),
  defineMethod({
    name: 'computer.hotkey',
    params: Hotkey,
    handler: async (params) => {
      return await callComputerSidecarAction('hotkey', params)
    }
  }),
  defineMethod({
    name: 'computer.pasteText',
    params: PasteText,
    handler: async (params) => {
      return await callComputerSidecarAction('pasteText', params)
    }
  }),
  defineMethod({
    name: 'computer.setValue',
    params: SetValue,
    handler: async (params) => {
      return await callComputerSidecarAction('setValue', params)
    }
  })
]
