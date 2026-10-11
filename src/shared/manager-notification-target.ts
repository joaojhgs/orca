export type ManagerNotificationTarget = Readonly<{ runId: string; messageId: string }>

const prefix = 'manager:v1:'
const runIdPattern = /^run_[a-zA-Z0-9_-]{1,128}$/
const messageIdPattern = /^msg_[a-zA-Z0-9_-]{1,128}$/

function validId(value: string, pattern: RegExp): boolean {
  return pattern.exec(value)?.[0] === value
}

/** Fits the existing gateway's opaque notification ID; never carries a URL or host authority. */
export function managerNotificationId(target: ManagerNotificationTarget): string {
  if (!validId(target.runId, runIdPattern) || !validId(target.messageId, messageIdPattern)) {
    throw new Error('Invalid manager notification target')
  }
  return `${prefix}${target.runId}:${target.messageId}`
}

export function readManagerNotificationTarget(value: unknown): ManagerNotificationTarget | null {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 280) {
    return null
  }
  const parts = value.slice(prefix.length).split(':')
  const [runId, messageId] = parts
  if (
    parts.length !== 2 ||
    !runId ||
    !messageId ||
    !validId(runId, runIdPattern) ||
    !validId(messageId, messageIdPattern)
  ) {
    return null
  }
  return { runId, messageId }
}
