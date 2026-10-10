import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { observeAgentNotification } from './agent-notification-worker'

const session = '01a112a5-d6bb-74e2-bf7c-ace73cb513b5'
let directory: string
let transcript: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-notification-evidence-'))
  vi.stubEnv('CODEX_HOME', directory)
  const day = new Date(Number.parseInt(session.replaceAll('-', '').slice(0, 12), 16))
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '/')
  mkdirSync(join(directory, 'sessions', day), { recursive: true })
  transcript = join(directory, 'sessions', day, `rollout-${session}.jsonl`)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})
function write(events: unknown[]) {
  writeFileSync(transcript, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
}
function lifecycle(type: string) {
  return { type: 'event_msg', payload: { type } }
}

it('detects a resumed root turn even when the old Stop hook is still done', () => {
  write([
    lifecycle('task_complete'),
    lifecycle('task_started'),
    { type: 'turn_context', payload: { approval_policy: 'never', approvals_reviewer: 'user' } }
  ])
  expect(observeAgentNotification(session)).toEqual({
    state: 'working',
    approvalPolicy: 'never',
    approvalsReviewer: 'user'
  })
})
it('ignores child completion and keeps the root working', () => {
  write([
    lifecycle('task_started'),
    { type: 'event_msg', payload: { type: 'sub_agent_activity', state: 'completed' } }
  ])
  expect(observeAgentNotification(session).state).toBe('working')
})
it('returns genuine root stops and cancellations separately', () => {
  write([lifecycle('task_started'), lifecycle('task_complete')])
  expect(observeAgentNotification(session).state).toBe('done')
  write([lifecycle('task_started'), lifecycle('turn_aborted')])
  expect(observeAgentNotification(session).state).toBe('interrupted')
})
it('uses changed settings and the established reviewer normalization', () => {
  write([
    { type: 'turn_context', payload: { approval_policy: 'never', approvals_reviewer: 'user' } },
    {
      type: 'event_msg',
      payload: {
        type: 'thread_settings_applied',
        thread_settings: {
          approval_policy: 'on-request',
          approvals_reviewer: 'guardian_subagent'
        }
      }
    },
    lifecycle('task_started')
  ])
  expect(observeAgentNotification(session)).toEqual({
    state: 'working',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review'
  })
})
it('fails closed on absent transcripts and incomplete records', () => {
  expect(observeAgentNotification(session).state).toBe('unverifiable')
  writeFileSync(transcript, JSON.stringify(lifecycle('task_complete')))
  expect(observeAgentNotification(session).state).toBe('unverifiable')
})

it('reads the host-reported rollout in a custom runtime home without probing another account', () => {
  write([lifecycle('task_started')])
  expect(observeAgentNotification(session, transcript).state).toBe('working')
  expect(
    observeAgentNotification(session, join(directory, 'missing', `rollout-${session}.jsonl`)).state
  ).toBe('unverifiable')
  expect(observeAgentNotification(session, join(directory, 'auth.json')).state).toBe('unverifiable')
})

it('finds a long-running turn beyond the last 1 MiB without letting older stops override it', () => {
  const noise = Array.from({ length: 400 }, () => ({
    type: 'response_item',
    payload: { text: 'x'.repeat(10000) }
  }))
  write([
    lifecycle('task_complete'),
    lifecycle('task_started'),
    { type: 'turn_context', payload: { approval_policy: 'never', approvals_reviewer: 'user' } },
    ...noise
  ])
  expect(observeAgentNotification(session)).toEqual({
    state: 'working',
    approvalPolicy: 'never',
    approvalsReviewer: 'user'
  })
})
