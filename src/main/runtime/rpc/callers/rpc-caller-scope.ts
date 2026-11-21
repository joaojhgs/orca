import { SSH_BRIDGE_HOST_METHODS, SSH_BRIDGE_REMOTE_CONTROL_HINT } from './ssh-bridge-method-policy'

/** Transport stamps proven scope; unstamped calls are local desktop/owner CLI. Non-owner methods require an explicitly granted permission. */
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../server/runtime-rpc-mobile-method-allowlist'
import { MANAGER_SERVICE_METHODS } from '../../manager/manager-service-methods'
import type { RpcMethodPermission, RuntimeDeviceGrant } from './rpc-method-permission'

export type RpcCallerScope =
  | { kind: 'owner' }
  | { kind: 'manager-service'; principalId: string }
  | { kind: 'ssh-bridge'; targetId: string; remoteCliControl: boolean }
  /** Delegated phones inherit at most their paired desktop's scope, which never includes pairing-admin. */
  | { kind: 'mobile'; delegated?: boolean }
  | { kind: 'runtime-paired'; grants: readonly RuntimeDeviceGrant[] }

export const OWNER_RPC_CALLER_SCOPE: RpcCallerScope = { kind: 'owner' }

// Remote UI needs settings/accounts/skills/SSH/updates; workspace already runs host-user commands (rpc-method-permission.ts).
// Desktop control requires pairing-time grant; pairing admin is never granted.
const RUNTIME_PAIRED_STANDARD: ReadonlySet<RpcMethodPermission> = new Set([
  'workspace',
  'settings-write',
  'accounts-admin',
  'skills-admin',
  'host-admin',
  'device-self'
])

/** Mobile checks unknown methods by name because older phones interpret forbidden as unsupported; other callers retain method_not_found. */
export function denyRpcMethodForCaller(
  scope: RpcCallerScope,
  methodName: string,
  permission: RpcMethodPermission | undefined
): string | null {
  if (scope.kind === 'manager-service') {
    return MANAGER_SERVICE_METHODS.has(methodName)
      ? null
      : `Method '${methodName}' is not available to a manager service.`
  }
  if (scope.kind === 'mobile') {
    if (!MOBILE_RPC_METHOD_ALLOWLIST.has(methodName)) {
      return `Method '${methodName}' is not available to mobile clients`
    }
    return scope.delegated && permission === 'pairing-admin'
      ? `Method '${methodName}' is not available to a phone connected through a paired desktop`
      : null
  }
  if (scope.kind === 'owner' || permission === undefined) {
    return null
  }
  if (scope.kind === 'ssh-bridge') {
    if (scope.remoteCliControl) {
      return permission === 'workspace'
        ? null
        : `Method '${methodName}' is not available to an SSH host's orca CLI.`
    }
    return permission === 'workspace' && SSH_BRIDGE_HOST_METHODS.has(methodName)
      ? null
      : `Method '${methodName}' is not available to the orca CLI on SSH host '${scope.targetId}'. ${SSH_BRIDGE_REMOTE_CONTROL_HINT}`
  }
  return !RUNTIME_PAIRED_STANDARD.has(permission) &&
    !scope.grants.some((grant) => grant === permission)
    ? `Method '${methodName}' needs the '${permission}' permission, which this paired client was not granted when it paired.`
    : null
}
