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
    params: null,
    handler: (_params, ctx) => administration(ctx).listNetworkInterfaces()
  }),
  defineMethod({
    name: 'pairing.admin.getPairingQR',
    params: PairingAdministrationQrParams,
    handler: (params, ctx) => administration(ctx).getPairingQR(params)
  }),
  defineMethod({
    name: 'pairing.admin.listDevices',
    params: null,
    handler: (_params, ctx) => administration(ctx).listDevices()
  }),
  defineMethod({
    name: 'pairing.admin.revokeDevice',
    params: PairingAdministrationDeviceParams,
    handler: (params, ctx) => administration(ctx).revokeDevice(params)
  }),
  defineMethod({
    name: 'pairing.admin.listRuntimeAccessGrants',
    params: null,
    handler: (_params, ctx) => administration(ctx).listRuntimeAccessGrants()
  }),
  defineMethod({
    name: 'pairing.admin.revokeRuntimeAccess',
    params: PairingAdministrationDeviceParams,
    handler: (params, ctx) => administration(ctx).revokeRuntimeAccess(params)
  }),
  defineMethod({
    name: 'pairing.admin.isWebSocketReady',
    params: null,
    handler: (_params, ctx) => administration(ctx).isWebSocketReady()
  })
]
