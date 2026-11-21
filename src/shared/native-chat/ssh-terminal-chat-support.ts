import {
  nativeChatPreferenceFor,
  type NativeChatDefaultSettings
} from '../agent-launch/choices/structured-native-chat-launch-route'
import { parseExecutionHostId } from '../execution-host/execution-host'

export function supportsSshTerminalChat(input: {
  executionHostId: string
  agent: string
}): boolean {
  return (
    parseExecutionHostId(input.executionHostId)?.kind === 'ssh' &&
    (input.agent === 'codex' || input.agent === 'claude' || input.agent === 'openclaude')
  )
}

export function sshTerminalChatViewMode(input: {
  agent: string
  connectionId: string | null | undefined
  requestedSurface?: 'chat' | 'terminal'
  settings: NativeChatDefaultSettings | null | undefined
}): 'chat' | 'terminal' {
  return supportsSshTerminalChat({
    agent: input.agent,
    executionHostId: input.connectionId ? `ssh:${input.connectionId}` : 'local'
  }) &&
    (input.requestedSurface === 'chat' ||
      (!input.requestedSurface && nativeChatPreferenceFor(input.settings, input.agent)))
    ? 'chat'
    : 'terminal'
}
