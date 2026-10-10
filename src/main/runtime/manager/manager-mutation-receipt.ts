import { createHash } from 'node:crypto'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'

/** Caller already holds a synchronous fenced transaction; no ambiguous effects escape it. */
export function managerMutationReceipt<T>(
  db: OrchestrationDb,
  principalId: string,
  requestId: string,
  method: string,
  input: unknown,
  parse: (value: unknown) => T,
  operation: () => T
): T {
  const identity = {
    callerFingerprint: `manager:${principalId}`,
    requestId,
    method,
    payloadHash: createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }
  const receipt = db.beginMutationReceipt(identity)
  if (receipt.disposition === 'completed' && receipt.row.receipt) {
    return parse(JSON.parse(receipt.row.receipt))
  }
  if (receipt.disposition !== 'started') {
    throw new OrchestrationError('operation_unknown', 'Manager request needs reconciliation')
  }
  const result = operation()
  db.completeMutationReceipt({ ...identity, receipt: JSON.stringify(result) })
  return result
}
