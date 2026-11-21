export type SshTargetRelayAction = 'reset' | 'terminate' | 'move'

export async function runSshTargetRelayAction(
  action: SshTargetRelayAction,
  targetId: string
): Promise<'moved' | 'unverified' | undefined> {
  const args = { targetId }
  if (action === 'move' && window.api.ssh.moveToManagedServer) {
    const result = await window.api.ssh.moveToManagedServer(args)
    return result.outcome === 'moved' ? 'moved' : undefined
  }
  if (action === 'terminate' && window.api.ssh.terminateSessions) {
    const result = await window.api.ssh.terminateSessions(args)
    return result.unverifiable > 0 ? 'unverified' : undefined
  }
  if (action === 'reset' && window.api.ssh.resetRelay) {
    await window.api.ssh.resetRelay(args)
  }
  return undefined
}
