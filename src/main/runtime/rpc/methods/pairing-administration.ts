import { defineMethod, type RpcContext } from '../core'
import {
  PairingAdministrationDeviceParams,
  PairingAdministrationQrParams
} from '../../../../shared/rpc-contract/pairing-administration-params'

function administration(ctx: RpcContext) {
  if (ctx.clientKind !== 'runtime' || !ctx.pairedDeviceId || !ctx.pairingAdministration) {
    throw new Error('Pairing management requires an authenticated full-runtime client')
  }
  return ctx.pairingAdministration
}

export const PAIRING_ADMINISTRATION_METHODS = [
  defineMethod({
    name: 'pairing.admin.listNetworkInterfaces',
    permission: 'host-admin',
    params: null,
    handler: (_params, ctx) => administration(ctx).listNetworkInterfaces()
  }),
  defineMethod({
    name: 'pairing.admin.getPairingQR',
    permission: 'host-admin',
    params: PairingAdministrationQrParams,
    handler: (params, ctx) => administration(ctx).getPairingQR(params)
  }),
  defineMethod({
    name: 'pairing.admin.listDevices',
    permission: 'host-admin',
    params: null,
    handler: (_params, ctx) => administration(ctx).listDevices()
  }),
  defineMethod({
    name: 'pairing.admin.revokeDevice',
    permission: 'host-admin',
    params: PairingAdministrationDeviceParams,
    handler: (params, ctx) => administration(ctx).revokeDevice(params)
  }),
  defineMethod({
    name: 'pairing.admin.listRuntimeAccessGrants',
    permission: 'host-admin',
    params: null,
    handler: (_params, ctx) => administration(ctx).listRuntimeAccessGrants()
  }),
  defineMethod({
    name: 'pairing.admin.revokeRuntimeAccess',
    permission: 'host-admin',
    params: PairingAdministrationDeviceParams,
    handler: (params, ctx) => administration(ctx).revokeRuntimeAccess(params)
  }),
  defineMethod({
    name: 'pairing.admin.isWebSocketReady',
    permission: 'host-admin',
    params: null,
    handler: (_params, ctx) => administration(ctx).isWebSocketReady()
  })
]
