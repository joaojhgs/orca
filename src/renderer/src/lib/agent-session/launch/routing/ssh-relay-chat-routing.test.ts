import { expect, it } from 'vitest'
import { hostChatAnswer } from './new-tab-agent-menu-rows'
import { resolveAgentLaunchRoute, type AgentLaunchRoutingInput } from './agent-launch-routing'
import { sshTerminalChatViewMode } from '../../../../../../shared/native-chat/ssh-terminal-chat-support'

it('uses the relay terminal for chat on an SSH workspace inside a paired server', () => {
  const input: AgentLaunchRoutingInput = {
    agent: 'codex',
    executionHostId: 'runtime:controller',
    sshConnectionId: 'coding-worker',
    settings: { agentDefaultSurface: 'chat' },
    hostCapabilities: [],
    preferredSurface: 'chat'
  }
  expect(hostChatAnswer(input)).toBe('yes')
  expect(resolveAgentLaunchRoute(input)).toBe('terminal-tui')
  expect(
    sshTerminalChatViewMode({
      agent: 'codex',
      connectionId: input.sshConnectionId,
      requestedSurface: 'chat',
      settings: input.settings
    })
  ).toBe('chat')
  expect(hostChatAnswer({ ...input, agent: 'opencode' })).toBe('ssh')
})
