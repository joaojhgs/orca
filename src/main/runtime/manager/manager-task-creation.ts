import type { OrchestrationDb } from '../orchestration/db'
import type { TaskRow } from '../orchestration/types'
import {
  ManagerTaskRequirementsSchema,
  type ManagerTaskRequirements
} from '../../../shared/manager-completion-contract'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { ManagerAuthorityError } from './manager-authority-error'
import {
  managerTaskCompletionInstructions,
  requireOpenManagerObjective,
  saveManagerTaskRequirements
} from './manager-completion-evidence'

/** Canonical child Task creation uses the same receipt/proof policy as direct manager tools. */
export function createManagerTaskWithRequirements(
  db: OrchestrationDb,
  input: { runId?: string; spec: string; completionRequirements?: ManagerTaskRequirements },
  create: (spec: string) => TaskRow
): TaskRow {
  const run = input.runId ? db.getRun(input.runId) : undefined
  if (!run || !db.managerRuns.eventScope(run)) {
    if (input.completionRequirements) {
      throw new ManagerAuthorityError(
        'manager_forbidden',
        'Only a service-owned Run can freeze manager requirements'
      )
    }
    return create(input.spec)
  }
  return runLifecycleWriteTransaction(db.db, 'manager_task_requirements_create', () => {
    requireOpenManagerObjective(db, run.id)
    const requirements = ManagerTaskRequirementsSchema.parse(
      input.completionRequirements ?? { role: 'work', tests: [] }
    )
    const task = create(input.spec + managerTaskCompletionInstructions(db, run.id, requirements))
    saveManagerTaskRequirements(db, task.id, requirements)
    return task
  })
}
