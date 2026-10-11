import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import {
  ManagerTaskRequirementsSchema,
  ManagerVerificationReportSchema,
  ManagerCompletionEvidenceSchema,
  type ManagerTaskRequirements,
  type ManagerCompletionEvidence
} from '../../../shared/manager-completion-contract'
import { ManagerAuthorityError } from './manager-authority-error'

const requirementsRow = z.object({ requirements: z.string() })
const certificateRow = z.object({ message_id: z.string() })

export function createManagerCompletionTables(db: OrchestrationDb['db']): void {
  db.exec(`CREATE TABLE IF NOT EXISTS manager_task_requirements (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    requirements TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS manager_objective_completions (
    message_id TEXT PRIMARY KEY REFERENCES manager_conversation_messages(message_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    consumer_generation INTEGER NOT NULL,
    objective_sequence INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    UNIQUE(run_id, consumer_generation, objective_sequence)
  );`)
}

function refuse(message: string): never {
  throw new ManagerAuthorityError('manager_forbidden', message)
}

export function readManagerTaskRequirements(db: OrchestrationDb, taskId: string) {
  const row = db.db
    .prepare('SELECT requirements FROM manager_task_requirements WHERE task_id = ?')
    .get(taskId)
  return row
    ? ManagerTaskRequirementsSchema.parse(JSON.parse(requirementsRow.parse(row).requirements))
    : null
}

export function saveManagerTaskRequirements(
  db: OrchestrationDb,
  taskId: string,
  requirements: ManagerTaskRequirements
): void {
  const task = db.getTask(taskId)
  if (!task) {
    refuse('Task requirements need a canonical Task')
  }
  if (requirements.role === 'verification') {
    const target = db.getTask(requirements.verifiesTaskId)
    const targetRequirements = target && readManagerTaskRequirements(db, target.id)
    if (
      !target ||
      target.run_id !== task.run_id ||
      target.status !== 'completed' ||
      targetRequirements?.role !== 'work'
    ) {
      refuse('Verification must address a completed work Task in this Run')
    }
  }
  db.db
    .prepare('INSERT INTO manager_task_requirements (task_id, requirements) VALUES (?, ?)')
    .run(taskId, JSON.stringify(requirements))
}

export function managerTaskCompletionInstructions(
  db: OrchestrationDb,
  runId: string,
  requirements: ManagerTaskRequirements
): string {
  if (requirements.role === 'work') {
    return `\n\nFrozen completion requirements (do not replace requested checks with easier ones):\n${JSON.stringify(requirements)}\nReport the actual result through this Dispatch's authenticated worker_done pathway. A separate verification worker will check it; do not declare the root objective verified yourself.`
  }
  const target = db.getTask(requirements.verifiesTaskId)
  const dispatch = target && db.getDispatchContext(target.id)
  const report =
    dispatch &&
    db
      .getAttemptObservationFacts(dispatch.id)
      .filter((fact) => fact.facet === 'worker_report')
      .sort((a, b) => b.sequence - a.sequence)[0]
  if (
    !target ||
    target.run_id !== runId ||
    !dispatch ||
    !report ||
    readManagerTaskRequirements(db, target.id)?.role !== 'work'
  ) {
    refuse('Verification target has no owned work report')
  }
  acceptedReport(db, target.id, dispatch.id, report.id)
  return `\n\nIndependent verification, not implementation: inspect the actual result and execute the requested checks. Do not merely repeat the implementation worker's claim. Target: ${JSON.stringify({ taskId: target.id, dispatchId: dispatch.id, reportId: report.id, requirements: readManagerTaskRequirements(db, target.id) })}.\nUse an authenticated successful worker_done only when every requested check passes. Its body must be JSON with version:1, verifiedTaskId, verifiedDispatchId, verifiedReportId matching this target, summary, tests:[{command,exitCode:0,output}], and git:{branch,commit:full SHA,clean:true} if Git evidence is requested. If checks fail or cannot be performed, report failure with the actual evidence instead; never invent passing output.`
}

export function managerObjectiveSequence(db: OrchestrationDb, runId: string): number {
  const row = z.object({ sequence: z.number() }).parse(
    db.db
      .prepare(`SELECT COALESCE(MAX(m.sequence), 0) AS sequence
    FROM manager_conversation_messages c JOIN messages m ON m.id = c.message_id
    WHERE c.run_id = ? AND c.role = 'human'`)
      .get(runId)
  )
  return row.sequence
}

export function requireOpenManagerObjective(db: OrchestrationDb, runId: string): void {
  const run = db.getRun(runId)
  if (!run) {
    refuse('Objective Run disappeared')
  }
  if (
    db.db
      .prepare(`SELECT 1 FROM manager_objective_completions
    WHERE run_id = ? AND consumer_generation = ? AND objective_sequence = ?`)
      .get(runId, run.consumer_generation, managerObjectiveSequence(db, runId))
  ) {
    refuse('This objective is complete; a new human instruction is required before more work')
  }
}

function acceptedReport(db: OrchestrationDb, taskId: string, dispatchId: string, reportId: string) {
  const task = db.getTask(taskId)
  const dispatch = db.getDispatchContextById(dispatchId)
  const current = db.getDispatchContext(taskId)
  if (
    !task ||
    task.status !== 'completed' ||
    !dispatch ||
    dispatch.task_id !== taskId ||
    dispatch.status !== 'completed' ||
    current?.id !== dispatchId
  ) {
    refuse('Completion needs the current completed Task/Dispatch, not an earlier attempt')
  }
  const facts = db
    .getAttemptObservationFacts(dispatchId)
    .filter((fact) => fact.facet === 'worker_report')
    .sort((a, b) => b.sequence - a.sequence)
  const fact = facts[0]
  const payload = z
    .object({
      status: z.literal('accepted'),
      outcome: z.literal('succeeded'),
      reportId: z.string()
    })
    .safeParse(fact?.payload)
  if (
    !payload.success ||
    payload.data.reportId !== reportId ||
    fact?.id !== reportId ||
    fact.authorityId !== `run_home:${task.run_id}` ||
    fact.authorityClock !== 'home'
  ) {
    refuse('Completion needs the latest authenticated successful worker report')
  }
  const messageId = reportId.startsWith('worker_report:')
    ? reportId.slice('worker_report:'.length)
    : ''
  const message = db.getMessageById(messageId)
  if (
    !message ||
    message.run_id !== task.run_id ||
    message.type !== 'worker_done' ||
    !message.body.trim()
  ) {
    refuse('Accepted worker report content is unavailable')
  }
  return { task, dispatch, message }
}

export function verifyManagerCompletion(
  db: OrchestrationDb,
  runId: string,
  evidence: ManagerCompletionEvidence
): void {
  const tasks = db.listTasks({ runId, limit: 201 })
  if (
    !tasks.length ||
    tasks.length > 200 ||
    evidence.length !== tasks.length ||
    new Set(evidence.map((entry) => entry.taskId)).size !== evidence.length ||
    tasks.some((task) => !evidence.some((entry) => entry.taskId === task.id))
  ) {
    refuse(
      'Completion must cover every Task exactly once; oversized Runs need explicit reconciliation'
    )
  }
  if (
    db.db
      .prepare(`SELECT 1 FROM decision_gates WHERE run_id = ? AND status = 'pending' LIMIT 1`)
      .get(runId) ||
    db.db
      .prepare(`SELECT 1 FROM question_threads WHERE run_id = ? AND status = 'pending' LIMIT 1`)
      .get(runId) ||
    db.db
      .prepare(`SELECT 1 FROM manager_conversation_messages c WHERE c.run_id = ? AND c.role = 'manager'
        AND c.kind = 'question' AND NOT EXISTS (SELECT 1 FROM manager_conversation_messages a
          WHERE a.role = 'human' AND a.reply_to = c.message_id) LIMIT 1`)
      .get(runId)
  ) {
    refuse('Pending questions or approval gates prevent objective completion')
  }
  const reports = evidence.map((entry) => ({
    ...entry,
    ...acceptedReport(db, entry.taskId, entry.dispatchId, entry.reportId),
    requirements: readManagerTaskRequirements(db, entry.taskId)
  }))
  for (const work of reports) {
    if (!work.requirements) {
      refuse('Task has no frozen completion requirements')
    }
    if (work.requirements.role !== 'work') {
      continue
    }
    const verifier = reports.find(
      (entry) =>
        entry.requirements?.role === 'verification' &&
        entry.requirements.verifiesTaskId === work.taskId
    )
    if (
      !verifier ||
      verifier.dispatchId === work.dispatchId ||
      !verifier.dispatch.assignee_handle ||
      !work.dispatch.assignee_handle ||
      verifier.dispatch.assignee_handle === work.dispatch.assignee_handle ||
      (verifier.dispatch.assignee_pane_key &&
        verifier.dispatch.assignee_pane_key === work.dispatch.assignee_pane_key)
    ) {
      refuse('Each work Task requires a separately dispatched verification Task')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(verifier.message.body)
    } catch {
      refuse('Verifier must report typed test/Git evidence, not a prose completion claim')
    }
    const checked = ManagerVerificationReportSchema.safeParse(parsed)
    if (
      !checked.success ||
      checked.data.verifiedTaskId !== work.taskId ||
      checked.data.verifiedDispatchId !== work.dispatchId ||
      checked.data.verifiedReportId !== work.reportId
    ) {
      refuse('Verification does not address the exact accepted work attempt')
    }
    if (
      work.requirements.tests.some(
        (command) => !checked.data.tests.some((test) => test.command === command)
      ) ||
      (work.requirements.gitBranch && checked.data.git?.branch !== work.requirements.gitBranch)
    ) {
      refuse('Requested tests or clean Git branch/commit evidence are missing')
    }
  }
}

export function managerCompletionMessage(db: OrchestrationDb, runId: string): string | null {
  const run = db.getRun(runId)
  const row =
    run &&
    db.db
      .prepare(`SELECT message_id, evidence FROM manager_objective_completions
    WHERE run_id = ? AND consumer_generation = ? AND objective_sequence = ?`)
      .get(runId, run.consumer_generation, managerObjectiveSequence(db, runId))
  if (!row) {
    return null
  }
  const evidence = z.object({ evidence: z.string() }).parse(row)
  try {
    verifyManagerCompletion(
      db,
      runId,
      ManagerCompletionEvidenceSchema.parse(JSON.parse(evidence.evidence))
    )
  } catch (error) {
    if (error instanceof ManagerAuthorityError) {
      return null
    }
    throw error
  }
  return certificateRow.parse(row).message_id
}
