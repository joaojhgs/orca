import { parseExecutionHostId } from '../../../../../../shared/execution-host/execution-host'
import { isNativeChatTranscriptLocalReadable } from '../../../../../../shared/native-chat/transcript/messages/native-chat-transcript-readability'
import {
  getConnectionIdFromState,
  getRepoConnectionIdFromState
} from '@/lib/workspace/ownership/connection-owner-resolution'
import type { AgentLaunchRouteStore, ProspectiveWorkspace } from './agent-launch-route-input'

export function agentLaunchTranscriptLocation(
  store: AgentLaunchRouteStore,
  workspace: ProspectiveWorkspace,
  executionHostId: string
) {
  const host = parseExecutionHostId(executionHostId)
  const connectionId = workspace.worktreeId
    ? getConnectionIdFromState(store, workspace.worktreeId)
    : workspace.repoId
      ? getRepoConnectionIdFromState(store, workspace.repoId)
      : host?.kind === 'ssh'
        ? host.targetId
        : null
  const sshConnectionId =
    connectionId === undefined
      ? getRepoConnectionIdFromState(store, workspace.repoId)
      : connectionId
  return {
    sshConnectionId,
    nativeChatTranscriptIsLocalReadable: isNativeChatTranscriptLocalReadable(sshConnectionId)
  }
}
