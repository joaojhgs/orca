import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import { recordManagerOrchestrationEvent } from './manager-orchestration-event'

/** Only actual worker-to-owner mail wakes the manager; its own guidance and heartbeats cannot. */
export function recordManagerMailEvent(db: OrchestrationDb, message: MessageRow): void {
  if (
    message.delivery_contract !== 'current_delivery' ||
    message.to_handle !== `run:${message.run_id}` ||
    !message.from_handle.startsWith('dispatch:') ||
    !['status', 'merge_ready', 'escalation', 'handoff', 'decision_gate'].includes(message.type)
  ) {
    return
  }
  const dispatchId = message.from_handle.slice('dispatch:'.length)
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch || dispatch.run_id !== message.run_id) {
    return
  }
  recordManagerOrchestrationEvent(db, {
    dispatchId,
    eventId: `manager-mail:${message.id}`,
    kind: 'mail',
    messageId: message.id,
    occurredAt: Date.parse(message.created_at),
    summary: `${message.subject}\n${message.body}`
  })
}
