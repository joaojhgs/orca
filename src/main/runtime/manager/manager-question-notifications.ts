import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { MobileNotificationDispatchEvent } from '../runtime-mobile-notification-controller'
import { managerNotificationId } from '../../../shared/manager-notification-target'
import { ManagerAuthorityError } from './manager-authority-error'

const pendingQuestion = z.object({ message_id: z.string(), run_id: z.string() })
type Question = z.infer<typeof pendingQuestion>
const drainingDatabases = new WeakSet<OrchestrationDb>()
type Runtime = Pick<
  OrcaRuntimeService,
  | 'getExistingOrchestrationDb'
  | 'getMobileNotificationListenerCount'
  | 'allowsMobileNotificationDelivery'
  | 'dispatchMobileNotification'
>

export function createManagerQuestionNotificationTable(db: OrchestrationDb['db']): void {
  db.exec(`CREATE TABLE IF NOT EXISTS manager_question_notifications (
    message_id TEXT PRIMARY KEY REFERENCES manager_conversation_messages(message_id) ON DELETE CASCADE,
    processed_at INTEGER,
    disposition TEXT CHECK(disposition IN ('handed-off', 'answered', 'fenced', 'muted'))
  );
  CREATE INDEX IF NOT EXISTS manager_question_notifications_pending
    ON manager_question_notifications(message_id) WHERE processed_at IS NULL;`)
}

/** Queue in the message transaction; never dispatch while its mutation receipt can roll back. */
export function queueManagerQuestionNotification(db: OrchestrationDb, messageId: string): void {
  db.db.prepare('INSERT INTO manager_question_notifications (message_id) VALUES (?)').run(messageId)
}

function retireQuestion(db: OrchestrationDb, messageId: string, disposition: string): void {
  db.db
    .prepare(`UPDATE manager_question_notifications SET processed_at = ?, disposition = ?
    WHERE message_id = ? AND processed_at IS NULL`)
    .run(Date.now(), disposition, messageId)
}

function questionEvent(
  db: OrchestrationDb,
  question: Question
): MobileNotificationDispatchEvent | null {
  if (
    db.db
      .prepare(`SELECT 1 FROM manager_conversation_messages
    WHERE role = 'human' AND reply_to = ?`)
      .get(question.message_id)
  ) {
    retireQuestion(db, question.message_id, 'answered')
    return null
  }
  const run = db.getRun(question.run_id)
  let scope
  try {
    const principalId = db.managerRuns.principalForRun(run)
    const principal = db.managerPrincipals.authorize(principalId, 'conversation:write')
    scope = db.managerRuns.requireOwnedRun(principalId, run, principal.grant.scope)
  } catch (error) {
    if (!(error instanceof ManagerAuthorityError)) {
      throw error
    }
    retireQuestion(db, question.message_id, 'fenced')
    return null
  }
  if (!run) {
    throw new Error('Question Run is missing')
  }
  const notificationId = managerNotificationId({ runId: run.id, messageId: question.message_id })
  return {
    type: 'notification',
    source: 'plugin',
    title: 'Hermes needs your decision',
    body: 'Open this objective in Manager to read and answer the question.',
    notificationId,
    attentionKey: notificationId,
    emittedAt: Date.now(),
    ...(scope.workspaceId && Buffer.byteLength(JSON.stringify(scope.workspaceId)) <= 1024
      ? { worktreeId: scope.workspaceId }
      : {}),
    notificationKind: 'question',
    notificationScope: {
      ...scope,
      actor: 'manager',
      sessionId: run.id,
      sessionGeneration: String(run.consumer_generation)
    }
  }
}

/** Handoff is not provider delivery; transport retries remain owned by the existing push service. */
export function deliverPendingManagerQuestions(runtime: Runtime): void {
  if (runtime.getMobileNotificationListenerCount() === 0) {
    return
  }
  const db = runtime.getExistingOrchestrationDb()
  if (!db || db.db.isTransaction || drainingDatabases.has(db)) {
    return
  }
  drainingDatabases.add(db)
  try {
    drainQuestions(runtime, db)
  } finally {
    drainingDatabases.delete(db)
  }
}

function drainQuestions(runtime: Runtime, db: OrchestrationDb): void {
  const pending = db.db
    .prepare(`SELECT c.message_id, c.run_id FROM manager_question_notifications n
    JOIN manager_conversation_messages c ON c.message_id = n.message_id
    JOIN messages m ON m.id = c.message_id
    WHERE n.processed_at IS NULL AND c.role = 'manager' AND c.kind = 'question'
    ORDER BY m.sequence LIMIT 50`)
    .all()
  for (const row of pending) {
    const question = pendingQuestion.parse(row)
    const event = questionEvent(db, question)
    if (!event) {
      continue
    }
    if (
      !runtime.allowsMobileNotificationDelivery(event) &&
      !runtime.allowsMobileNotificationDelivery(event, undefined, 'desktop')
    ) {
      retireQuestion(db, question.message_id, 'muted')
      continue
    }
    runtime.dispatchMobileNotification(event)
    retireQuestion(db, question.message_id, 'handed-off')
  }
}

export function tryDeliverPendingManagerQuestions(runtime: Runtime): void {
  try {
    deliverPendingManagerQuestions(runtime)
  } catch {
    console.warn('[manager] Question notification handoff failed; pending intents will be retried')
  }
}

export function startManagerQuestionNotificationRecovery(runtime: Runtime): () => void {
  tryDeliverPendingManagerQuestions(runtime)
  const timer = setInterval(() => tryDeliverPendingManagerQuestions(runtime), 5_000)
  timer.unref()
  return () => clearInterval(timer)
}
