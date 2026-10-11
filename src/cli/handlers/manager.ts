import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  ManagerEventCursorSchema,
  MANAGER_EVENTS_RUNTIME_CAPABILITY
} from '../../shared/manager-event-contract'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { readManagerCredential } from '../manager-credential'
import { managerConversationHandlers } from './manager-conversation'
import {
  ManagerConsumerLeaseSchema,
  ManagerPrincipalGrantSchema
} from '../../shared/manager-principal-contract'

type Flags = HandlerContext['flags']
function text(flags: Flags, name: string): string {
  const value = flags.get(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new RuntimeClientError('invalid_argument', `Missing --${name}`)
  }
  return value
}
function optionalJson(flags: Flags, name: string): unknown {
  return flags.has(name) ? JSON.parse(text(flags, name)) : undefined
}
function number(flags: Flags, name: string, fallback: number): number {
  return flags.has(name) ? Number(text(flags, name)) : fallback
}
function operation(
  method: string,
  params: (flags: Flags) => Record<string, unknown>,
  timeoutMs = 40_000
): CommandHandler {
  return async ({ client, flags, json }) => {
    const status = await client.call<RuntimeStatus>('status.get')
    if (!status.result.capabilities?.includes(MANAGER_EVENTS_RUNTIME_CAPABILITY)) {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca server does not support durable manager events'
      )
    }
    const result = await client.call(
      method,
      { ...params(flags), serviceToken: readManagerCredential() },
      { timeoutMs }
    )
    printResult(result, json, (value) => JSON.stringify(value, null, 2))
  }
}

export const MANAGER_HANDLERS: Record<string, CommandHandler> = {
  ...managerConversationHandlers(operation, text),
  ...Object.fromEntries(
    ['placements', 'usage', 'resources'].map((name) => [
      `manager ${name}`,
      operation(`manager.${name}`, (flags) => ({
        offset: number(flags, 'offset', 0),
        limit: number(flags, 'limit', 100)
      }))
    ])
  ),
  'manager check': operation('manager.mailboxCheck', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    runId: text(flags, 'run'),
    limit: number(flags, 'limit', 100)
  })),
  'manager ack': operation('manager.mailboxAck', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    runId: text(flags, 'run'),
    deliveryId: text(flags, 'delivery')
  })),
  'manager worker-guide': operation('manager.workerGuide', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    requestId: text(flags, 'request-id'),
    runId: text(flags, 'run'),
    dispatchId: text(flags, 'dispatch'),
    body: text(flags, 'body')
  })),
  'manager question-answer': operation('manager.questionAnswer', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    requestId: text(flags, 'request-id'),
    runId: text(flags, 'run'),
    messageId: text(flags, 'message'),
    body: text(flags, 'body')
  })),
  'manager worker-start': operation(
    'manager.workerStart',
    (flags) => ({
      lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
      requestId: text(flags, 'request-id'),
      runId: text(flags, 'run'),
      taskId: text(flags, 'task'),
      workspaceId: text(flags, 'workspace-id'),
      agent: text(flags, 'agent'),
      model: flags.has('model') ? text(flags, 'model') : undefined,
      effort: flags.has('effort') ? text(flags, 'effort') : undefined,
      retryOf: flags.has('retry-of') ? text(flags, 'retry-of') : undefined,
      workClass: flags.has('work-class') ? text(flags, 'work-class') : undefined,
      timeoutMs: number(flags, 'timeout-ms', 60_000)
    }),
    120_000
  ),
  'manager worker-show': operation('manager.workerShow', (flags) => ({
    runId: text(flags, 'run'),
    dispatchId: text(flags, 'dispatch')
  })),
  'manager worker-read': operation('manager.workerRead', (flags) => ({
    runId: text(flags, 'run'),
    dispatchId: text(flags, 'dispatch'),
    cursor: optionalJson(flags, 'cursor'),
    source: flags.has('source') ? text(flags, 'source') : undefined,
    limit: number(flags, 'limit', 100)
  })),
  'manager run-list': operation('manager.runList', (flags) => ({
    offset: number(flags, 'offset', 0),
    limit: number(flags, 'limit', 100)
  })),
  'manager run-create': operation('manager.runCreate', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    requestId: text(flags, 'request-id'),
    workspaceId: text(flags, 'workspace-id'),
    objective: text(flags, 'objective')
  })),
  'manager run-show': operation('manager.runShow', (flags) => ({ runId: text(flags, 'run') })),
  'manager task-list': operation('manager.taskList', (flags) => ({
    runId: text(flags, 'run'),
    offset: number(flags, 'offset', 0),
    limit: number(flags, 'limit', 100)
  })),
  'manager task-show': operation('manager.taskShow', (flags) => ({
    runId: text(flags, 'run'),
    taskId: text(flags, 'task')
  })),
  'manager task-create': operation('manager.taskCreate', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    requestId: text(flags, 'request-id'),
    runId: text(flags, 'run'),
    spec: text(flags, 'spec'),
    taskTitle: flags.has('title') ? text(flags, 'title') : undefined,
    deps: flags.has('deps') ? text(flags, 'deps').split(',') : [],
    parentId: flags.has('parent') ? text(flags, 'parent') : undefined,
    completionRequirements: optionalJson(flags, 'requirements')
  })),
  'manager snapshot': operation('manager.snapshot', (flags) => ({
    offset: number(flags, 'offset', 0),
    limit: number(flags, 'limit', 100)
  })),
  'manager read': operation('manager.eventsRead', (flags) => ({
    cursor: ManagerEventCursorSchema.optional().parse(optionalJson(flags, 'cursor')),
    limit: number(flags, 'limit', 100)
  })),
  'manager wait': operation('manager.eventsWait', (flags) => ({
    cursor: ManagerEventCursorSchema.optional().parse(optionalJson(flags, 'cursor')),
    timeoutMs: number(flags, 'timeout-ms', 30_000)
  })),
  'manager claim': operation('manager.consumerClaim', (flags) => ({
    consumerId: text(flags, 'consumer'),
    durationMs: number(flags, 'duration-ms', 60_000)
  })),
  'manager renew': operation('manager.consumerRenew', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    durationMs: number(flags, 'duration-ms', 60_000)
  })),
  'manager checkpoint': operation('manager.eventsCheckpoint', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease')),
    cursor: ManagerEventCursorSchema.parse(optionalJson(flags, 'cursor'))
  })),
  'manager release': operation('manager.consumerRelease', (flags) => ({
    lease: ManagerConsumerLeaseSchema.parse(optionalJson(flags, 'lease'))
  })),
  'manager revoke': async ({ client, flags, json }) => {
    printResult(
      await client.call('manager.revoke', { principalId: text(flags, 'principal') }),
      json,
      (value) => JSON.stringify(value)
    )
  },
  'manager authorize': async ({ client, flags, cwd, json }) => {
    const path = resolve(cwd, text(flags, 'credential-file'))
    const grant = ManagerPrincipalGrantSchema.parse(
      JSON.parse(readFileSync(resolve(cwd, text(flags, 'grant-file')), 'utf8'))
    )
    const response = await client.call('manager.issue', {
      label: text(flags, 'label'),
      grant,
      expiresAt: number(flags, 'expires-at', Number.NaN)
    })
    const issued = z
      .object({ token: z.string(), principal: z.object({ id: z.string() }).passthrough() })
      .parse(response.result)
    try {
      writeFileSync(
        path,
        JSON.stringify({ principal: issued.principal, serviceToken: issued.token }),
        { flag: 'wx', mode: 0o600 }
      )
    } catch (error) {
      await client.call('manager.revoke', { principalId: issued.principal.id })
      throw error
    }
    printResult(
      { ...response, result: { principal: issued.principal, credentialFile: path } },
      json,
      (value) => JSON.stringify(value, null, 2)
    )
  }
}
