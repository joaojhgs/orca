import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { exposeMessageTimestamps } from '../orchestration/db/utc-timestamp'
import {
  ManagerConversationMessageSchema,
  type ManagerConversationMessage
} from '../../../shared/manager-conversation-contract'
import { ManagerAuthorityError } from './manager-authority-error'

const provenance = z.object({
  message_id: z.string(),
  role: z.enum(['human', 'manager']),
  kind: z.enum(['reply', 'question', 'progress']),
  reply_to: z.string().nullable()
})

/** Provenance only: message content, ordering and delivery stay in Orca's existing mailbox. */
export function createManagerConversationTable(db: OrchestrationDb['db']): void {
  db.exec(`CREATE TABLE IF NOT EXISTS manager_conversation_messages (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('human', 'manager')),
    kind TEXT NOT NULL CHECK(kind IN ('reply', 'question', 'progress')),
    reply_to TEXT REFERENCES messages(id)
  );
  CREATE INDEX IF NOT EXISTS manager_conversation_run ON manager_conversation_messages(run_id);
  CREATE UNIQUE INDEX IF NOT EXISTS manager_conversation_question_answer
    ON manager_conversation_messages(reply_to) WHERE role = 'human' AND reply_to IS NOT NULL;`)
}

function conversationMessage(db: OrchestrationDb, value: unknown) {
  const source = provenance.parse(value)
  const message = db.getMessageById(source.message_id)
  if (!message) {
    throw new Error('Conversation message is missing')
  }
  return ManagerConversationMessageSchema.parse({
    id: message.id,
    runId: message.run_id,
    sequence: message.sequence,
    role: source.role,
    kind: source.kind,
    body: message.body,
    replyTo: source.reply_to,
    createdAt: exposeMessageTimestamps(message).created_at
  })
}

export function readManagerConversation(
  db: OrchestrationDb,
  runId: string,
  afterSequence: number,
  limit: number
) {
  const rows = db.db
    .prepare(`SELECT c.* FROM manager_conversation_messages c
      JOIN messages m ON m.id = c.message_id
      WHERE c.run_id = ? AND m.sequence > ? ORDER BY m.sequence LIMIT ?`)
    .all(runId, afterSequence, limit + 1)
  const messages: ManagerConversationMessage[] = []
  let bytes = 0
  for (const row of rows.slice(0, limit)) {
    const message = conversationMessage(db, row)
    bytes += Buffer.byteLength(JSON.stringify(message))
    if (bytes > 128 * 1024) {
      break
    }
    messages.push(message)
  }
  return {
    messages,
    nextSequence: messages.at(-1)?.sequence ?? afterSequence,
    hasMore: rows.length > messages.length
  }
}

export function appendManagerConversation(
  db: OrchestrationDb,
  input: {
    runId: string
    role: 'human' | 'manager'
    kind: 'reply' | 'question' | 'progress'
    body: string
    replyTo?: string
  }
) {
  return runLifecycleWriteTransaction(db.db, 'manager_conversation_append', () => {
    const run = db.getRun(input.runId)
    const scope = run && db.managerRuns.eventScope(run)
    if (!run || !scope) {
      throw new ManagerAuthorityError('manager_consumer_fenced', 'Conversation coordinator changed')
    }
    if (input.replyTo) {
      const source = db.db
        .prepare(`SELECT * FROM manager_conversation_messages
          WHERE message_id = ? AND run_id = ? AND role != ?`)
        .get(input.replyTo, run.id, input.role)
      if (!source || (input.role === 'human' && provenance.parse(source).kind !== 'question')) {
        throw new ManagerAuthorityError(
          'manager_forbidden',
          'Reply does not address this conversation'
        )
      }
    }
    const human = input.role === 'human'
    if (
      human &&
      input.replyTo &&
      db.db
        .prepare(
          "SELECT 1 FROM manager_conversation_messages WHERE reply_to = ? AND role = 'human'"
        )
        .get(input.replyTo)
    ) {
      throw new ManagerAuthorityError('manager_forbidden', 'Human question is already answered')
    }
    const message = db.insertMessage({
      runId: run.id,
      from: human ? 'human:owner' : `run:${run.id}`,
      to: human ? `run:${run.id}` : 'human:owner',
      subject: human ? 'Human manager message' : 'Manager response',
      body: input.body,
      type: 'status',
      threadId: `manager-conversation:${run.id}`,
      deliveryContract: human ? 'current_delivery' : 'audit_only'
    })
    db.db
      .prepare(`INSERT INTO manager_conversation_messages
        (message_id, run_id, role, kind, reply_to) VALUES (?, ?, ?, ?, ?)`)
      .run(message.id, run.id, input.role, input.kind, input.replyTo ?? null)
    if (human) {
      db.managerEvents.append({
        eventId: `manager-conversation:${message.id}`,
        source: 'manager-conversation',
        sourceGeneration: `${run.id}:${run.consumer_generation}`,
        kind: 'mail',
        scope: { ...scope, runId: run.id, actor: 'root' },
        occurredAt: Date.parse(message.created_at),
        summary: input.body.slice(0, 4096),
        messageId: message.id
      })
    }
    return conversationMessage(db, {
      message_id: message.id,
      role: input.role,
      kind: input.kind,
      reply_to: input.replyTo ?? null
    })
  })
}
