export const SSH_BRIDGE_REMOTE_CONTROL_HINT =
  'To let that host\'s CLI control this Orca, enable "Allow this host\'s orca CLI to control Orca" in Settings > SSH for that host.'

export const SSH_BRIDGE_ORCHESTRATION_TERMINAL_CALLER_METHODS: ReadonlySet<string> = new Set([
  'orchestration.check',
  'orchestration.inbox'
])

export type SshBridgeHostBinding = 'status' | 'terminal-list' | 'terminal-handle' | 'orchestration'

export const SSH_BRIDGE_HOST_METHODS: ReadonlyMap<string, SshBridgeHostBinding> = new Map([
  ['status.get', 'status'],
  ['terminal.list', 'terminal-list'],
  ['terminal.show', 'terminal-handle'],
  ['terminal.read', 'terminal-handle'],
  ['terminal.send', 'terminal-handle'],
  ['terminal.wait', 'terminal-handle'],
  ...[
    ...SSH_BRIDGE_ORCHESTRATION_TERMINAL_CALLER_METHODS,
    'orchestration.send',
    'orchestration.ask',
    'orchestration.reply'
  ].map((method): [string, SshBridgeHostBinding] => [method, 'orchestration'])
])
