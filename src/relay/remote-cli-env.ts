import { readOptionalManagerCredential } from '../cli/manager-credential'

export function pickRemoteCliEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of [
    'ORCA_TERMINAL_HANDLE',
    'ORCA_WORKTREE_ID',
    'ORCA_PANE_KEY',
    'ORCA_AGENT_LAUNCH_TOKEN',
    'ORCA_WORKSPACE_ID',
    'ORCA_USER_DATA_PATH',
    'PATH',
    'Path'
  ]) {
    const value = env[key]
    if (typeof value === 'string') {
      picked[key] = value
    }
  }
  const managerCredential = readOptionalManagerCredential(env)
  if (managerCredential !== null) {
    picked.ORCA_MANAGER_TOKEN = managerCredential
  }
  return picked
}
