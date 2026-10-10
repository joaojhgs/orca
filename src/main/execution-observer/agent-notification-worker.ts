import { homedir } from 'node:os'
import { statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import {
  readJsonlCursor,
  readTranscriptDirectory,
  record
} from '../../shared/codex-rollout-jsonl-cursor'
import type { AgentNotificationEvidence } from '../../shared/agent-notification-evidence'
import { readApprovalsReviewer } from '../../shared/codex-subagent-reviewer'
import { isCodexStatusTranscriptLine } from '../../shared/codex-status-transcript-line'

// Long turns can bury their opening marker; bounded overlapping pages avoid a full history scan.
export function observeAgentNotification(
  sessionId: string,
  transcriptPath?: string
): AgentNotificationEvidence {
  if (
    transcriptPath &&
    (!isAbsolute(transcriptPath) || !basename(transcriptPath).endsWith(`-${sessionId}.jsonl`))
  ) {
    return { state: 'unverifiable' }
  }
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
  const days = new Set<string>()
  if (transcriptPath) {
    days.add('')
  } else if (sessionId[14] === '7') {
    const timestamp = Number.parseInt(sessionId.replaceAll('-', '').slice(0, 12), 16)
    for (const offset of [-1, 0, 1]) {
      days.add(
        join(...new Date(timestamp + offset * 86400000).toISOString().slice(0, 10).split('-'))
      )
    }
  } else {
    for (const year of readTranscriptDirectory(root)
      .filter((name) => /^\d{4}$/.test(name))
      .sort()
      .toReversed()) {
      for (const month of readTranscriptDirectory(join(root, year))
        .filter((name) => /^\d{2}$/.test(name))
        .sort()
        .toReversed()) {
        for (const day of readTranscriptDirectory(join(root, year, month))
          .filter((name) => /^\d{2}$/.test(name))
          .sort()
          .toReversed()) {
          days.add(join(year, month, day))
          if (days.size >= 256) {
            break
          }
        }
        if (days.size >= 256) {
          break
        }
      }
      if (days.size >= 256) {
        break
      }
    }
  }
  const evidence: AgentNotificationEvidence = { state: 'unverifiable' }
  for (const day of days) {
    const name = transcriptPath
      ? undefined
      : readTranscriptDirectory(join(root, day)).find((name) =>
          name.endsWith(`-${sessionId}.jsonl`)
        )
    const filePath = transcriptPath ?? (name ? join(root, day, name) : undefined)
    if (!filePath) {
      continue
    }
    let end: number
    try {
      end = statSync(filePath).size
    } catch {
      return evidence
    }
    for (let page = 0; page < 22 && end > 0; page++, end = Math.max(0, end - 768 * 1024)) {
      const older = readNotificationPage(filePath, end)
      if (!older) {
        return evidence
      }
      if (evidence.state === 'unverifiable') {
        evidence.state = older.state
      }
      evidence.approvalPolicy ??= older.approvalPolicy
      evidence.approvalsReviewer ??= older.approvalsReviewer
      if (
        evidence.state !== 'unverifiable' &&
        evidence.approvalPolicy &&
        evidence.approvalsReviewer
      ) {
        break
      }
    }
    return evidence
  }
  return evidence
}

function readNotificationPage(
  filePath: string,
  endOffset: number
): AgentNotificationEvidence | undefined {
  const evidence: AgentNotificationEvidence = { state: 'unverifiable' }
  const records = readJsonlCursor(
    { filePath, offset: 0, carry: '' },
    isCodexStatusTranscriptLine,
    endOffset
  )
  if (!records) {
    return undefined
  }
  evidence.approvalsReviewer = readApprovalsReviewer(records)
  for (const item of records) {
    const payload = record(item.payload)
    if (!payload) {
      continue
    }
    if (item.type === 'turn_context' || payload.type === 'thread_settings_applied') {
      const settings =
        payload.type === 'thread_settings_applied' ? record(payload.thread_settings) : payload
      if (typeof settings?.approval_policy === 'string') {
        evidence.approvalPolicy = settings.approval_policy
      }
    }
    if (item.type !== 'event_msg') {
      continue
    }
    if (payload.type === 'task_started' || payload.type === 'turn_started') {
      evidence.state = 'working'
    }
    if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
      evidence.state = 'done'
    }
    if (payload.type === 'turn_aborted') {
      evidence.state = 'interrupted'
    }
  }
  return evidence
}
