import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import { ManagerEventScopeSchema } from '../../../shared/manager-event-contract'
import type { ManagerEventInput } from '../../../shared/manager-event-contract'

/** Called inside the source transaction; human notification preferences are not consulted. */
export function recordManagerOrchestrationEvent(
  db: OrchestrationDb,
  input: {
    dispatchId: string
    eventId: string
    kind: 'question' | 'dispatch-settled' | 'failure' | 'mail'
    occurredAt: number
    summary: string
    messageId?: string
    outcome?: 'succeeded' | 'failed'
  }
): void {
  const dispatch = db.getDispatchContextById(input.dispatchId)
  const run = dispatch && db.getRun(dispatch.run_id)
  if (!run || !db.managerRuns.eventScope(run)) {
    return
  }
  const worker = db.getWorkerDispatch(input.dispatchId)
  const parsed =
    worker &&
    z.object({ managerScope: ManagerEventScopeSchema }).safeParse(JSON.parse(worker.start_options))
  if (!parsed?.success) {
    return
  }
  const scope = parsed.data.managerScope
  const event: ManagerEventInput = {
    eventId: input.eventId,
    source: 'orchestration-database',
    sourceGeneration: `${run.id}:${run.consumer_generation}`,
    kind: input.kind,
    occurredAt: input.occurredAt,
    summary: input.summary.slice(0, 4096),
    scope: { ...scope, runId: run.id, dispatchId: input.dispatchId, actor: 'worker' },
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {})
  }
  db.managerEvents.append(event)
}
