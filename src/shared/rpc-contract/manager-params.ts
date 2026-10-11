import { z } from 'zod'
import { ManagerEventCursorSchema } from '../manager-event-contract'
import {
  ManagerConsumerLeaseSchema,
  ManagerPrincipalGrantSchema
} from '../manager-principal-contract'
import { ORCHESTRATION_WORKER_READ_SOURCES } from '../orchestration-worker-output'
import { ManagerTaskRequirementsSchema } from '../manager-completion-contract'

const serviceToken = z.string().regex(/^orcam_[A-Za-z0-9_-]{43}$/)
export const ManagerIssueParams = z.strictObject({
  label: z.string().min(1).max(200),
  grant: ManagerPrincipalGrantSchema,
  expiresAt: z.number().int().positive()
})
export const ManagerRevokeParams = z.strictObject({ principalId: z.string().min(1).max(512) })
export const ManagerEventsReadParams = z.strictObject({
  serviceToken,
  cursor: ManagerEventCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100)
})
export const ManagerSnapshotParams = z.strictObject({
  serviceToken,
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(200).default(100)
})
export const ManagerEventsWaitParams = z.strictObject({
  serviceToken,
  cursor: ManagerEventCursorSchema.optional(),
  timeoutMs: z.number().int().min(1).max(30_000).default(30_000)
})
export const ManagerClaimParams = z.strictObject({
  serviceToken,
  consumerId: z.string().min(1).max(512),
  durationMs: z.number().int().min(1000).max(60_000).default(60_000)
})
export const ManagerRenewParams = z.strictObject({
  serviceToken,
  lease: ManagerConsumerLeaseSchema,
  durationMs: z.number().int().min(1000).max(60_000).default(60_000)
})
export const ManagerReleaseParams = z.strictObject({
  serviceToken,
  lease: ManagerConsumerLeaseSchema
})
export const ManagerCheckpointParams = z.strictObject({
  serviceToken,
  lease: ManagerConsumerLeaseSchema,
  cursor: ManagerEventCursorSchema
})

const managerWrite = { serviceToken, lease: ManagerConsumerLeaseSchema }
const requestId = z.string().min(1).max(512)
export const ManagerRunCreateParams = z.strictObject({
  ...managerWrite,
  requestId,
  workspaceId: z.string().min(1).max(4096),
  objective: z.string().trim().min(1).max(32_000)
})
export const ManagerRunShowParams = z.strictObject({
  serviceToken,
  runId: z.string().min(1).max(512)
})
export const ManagerRunListParams = z.strictObject({
  serviceToken,
  offset: z.number().int().min(0).max(1000).default(0),
  limit: z.number().int().min(1).max(200).default(100)
})
export const ManagerTaskListParams = z.strictObject({
  serviceToken,
  runId: z.string().min(1).max(512),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(200).default(100)
})
export const ManagerTaskShowParams = z.strictObject({
  serviceToken,
  runId: z.string().min(1).max(512),
  taskId: z.string().min(1).max(512)
})
export const ManagerWorkerShowParams = z.strictObject({
  serviceToken,
  runId: z.string().min(1).max(512),
  dispatchId: z.string().min(1).max(512)
})
export const ManagerWorkerReadParams = ManagerWorkerShowParams.extend({
  cursor: z.union([z.number().int().nonnegative(), z.string().min(1).max(2048)]).optional(),
  limit: z.number().int().min(1).max(200).default(100),
  source: z.enum(ORCHESTRATION_WORKER_READ_SOURCES).optional()
})
export const ManagerTaskCreateParams = z.strictObject({
  ...managerWrite,
  requestId,
  runId: z.string().min(1).max(512),
  spec: z.string().trim().min(1).max(128_000),
  taskTitle: z.string().trim().min(1).max(200).optional(),
  deps: z.array(z.string().min(1).max(512)).max(100).default([]),
  parentId: z.string().min(1).max(512).optional(),
  completionRequirements: ManagerTaskRequirementsSchema.default({ role: 'work', tests: [] })
})
export const ManagerWorkerStartParams = z.strictObject({
  ...managerWrite,
  requestId,
  runId: z.string().min(1).max(512),
  taskId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(4096),
  agent: z.enum(['codex', 'claude', 'opencode', 'cursor', 'gemini', 'hermes', 'antigravity']),
  model: z.string().trim().min(1).max(512).optional(),
  effort: z.string().trim().min(1).max(512).optional(),
  retryOf: z.string().min(1).max(512).optional(),
  workClass: z.enum(['edit', 'build']).default('build'),
  timeoutMs: z.number().int().min(1000).max(60_000).default(60_000)
})
export const ManagerMailboxCheckParams = z.strictObject({
  ...managerWrite,
  runId: z.string().min(1).max(512),
  limit: z.number().int().min(1).max(100).default(100)
})
export const ManagerMailboxAckParams = z.strictObject({
  ...managerWrite,
  runId: z.string().min(1).max(512),
  deliveryId: z.string().min(1).max(512)
})
export const ManagerWorkerGuideParams = ManagerWorkerShowParams.extend({
  lease: ManagerConsumerLeaseSchema,
  requestId,
  body: z.string().trim().min(1).max(32_000)
})
export const ManagerQuestionAnswerParams = z.strictObject({
  ...managerWrite,
  requestId,
  runId: z.string().min(1).max(512),
  messageId: z.string().min(1).max(512),
  body: z.string().trim().min(1).max(32_000)
})
