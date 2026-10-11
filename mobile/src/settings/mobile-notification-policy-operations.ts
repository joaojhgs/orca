import {
  NotificationPolicyReceiptSchema,
  NotificationPolicyTargetsPageSchema
} from '../../../src/shared/notification-policy-target'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import type { RpcClient } from '../transport/rpc-client'
import type { NotificationScopePolicy } from '../../../src/shared/notification-scope-policy'
import { z } from 'zod'

const read = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'notifications.policy-read',
    method: 'notifications.policyRead',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('notification-policy', NotificationPolicyReceiptSchema)
  })
)
const update = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'notifications.policy-update',
    method: 'notifications.policyUpdate',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('notification-policy', NotificationPolicyReceiptSchema)
  })
)
const targets = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'notifications.policy-targets',
    method: 'notifications.policyTargets',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('notification-targets', NotificationPolicyTargetsPageSchema)
  })
)
const devices = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'notifications.paired-devices',
    method: 'pairing.admin.listDevices',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'notification-devices',
      z.object({
        devices: z
          .array(
            z.object({
              deviceId: z.string().min(1).max(1024),
              name: z.string().min(1).max(4096)
            })
          )
          .max(1000)
      })
    )
  })
)

export function mobileNotificationPolicyCall(client: RpcClient, isCurrent: () => boolean) {
  const generation = client.getGeneration?.() ?? 0
  const requireCurrent = () => {
    if (
      !isCurrent() ||
      (client.getGeneration?.() ?? 0) !== generation ||
      client.getState() !== 'connected'
    ) {
      throw new Error('Server connection changed. Refresh notification rules before editing.')
    }
  }
  const options = { timeoutMs: 20000, failWhenDisconnected: true }
  return {
    async devices() {
      requireCurrent()
      const reply = await devices.request(client, null, options)
      requireCurrent()
      return devices.interpret(reply)
    },
    async read() {
      requireCurrent()
      const reply = await read.request(client, null, options)
      requireCurrent()
      return read.interpret(reply)
    },
    async update(policy: NotificationScopePolicy, expectedRevision: string) {
      requireCurrent()
      const reply = await update.request(client, { policy, expectedRevision }, options)
      requireCurrent()
      return update.interpret(reply)
    },
    async targets(offset: number) {
      requireCurrent()
      const reply = await targets.request(client, { offset, limit: 200 }, options)
      requireCurrent()
      return targets.interpret(reply)
    }
  }
}
