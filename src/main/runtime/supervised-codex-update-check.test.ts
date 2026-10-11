import { describe, expect, it } from 'vitest'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import { tokenizeStartupCommand } from '../../shared/tui-agent-startup-shell'
import { buildRuntimeAgentTerminalStartupOptions } from './runtime-agent-terminal-startup'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'
import type { RuntimeStore } from './runtime-store-contract'
import type { SessionOptionValue } from '../../shared/native-chat-session-options'

async function launch(
  options: TerminalCreateOptions = { startupAgent: 'codex', launchSource: 'orchestration' },
  settings: ReturnType<RuntimeStore['getSettings']> = createGlobalSettingsFixture(),
  platform: NodeJS.Platform = 'linux',
  remote = true,
  sessionOptions?: Record<string, SessionOptionValue>
) {
  return buildRuntimeAgentTerminalStartupOptions(
    {
      id: 'folder:acceptance',
      path: '/projects/acceptance',
      connectionId: remote ? 'worker' : null,
      repo: null,
      folderWorkspace: null
    },
    options,
    settings,
    platform,
    sessionOptions,
    remote ? 'ssh:worker' : 'local'
  )
}

function argv(command: string | undefined, shell: 'posix' | 'powershell' = 'posix') {
  const parsed = tokenizeStartupCommand(command ?? '', shell)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.tokens
}

describe('operator-managed Codex updates for unattended workers', () => {
  it.each(['linux', 'darwin', 'win32'] as const)(
    'pins startup update checks off on %s',
    async (platform) => {
      const result = await launch(undefined, undefined, platform)
      expect(result.command).toContain('check_for_update_on_startup=false')
      expect(result.command).toContain('--dangerously-bypass-approvals-and-sandbox')
      expect(result.launchAgent).toBe('codex')
    }
  )

  it('also applies to local folder workers', async () => {
    expect((await launch(undefined, undefined, 'linux', false)).command).toContain(
      'check_for_update_on_startup=false'
    )
  })

  it.each(['terminal', 'worktree', undefined])(
    'leaves manual launch source %s unchanged',
    async (launchSource) => {
      const result = await launch({ startupAgent: 'codex', launchSource })
      expect(result.command).not.toContain('check_for_update_on_startup')
    }
  )

  it('does not change bare commands or another runtime', async () => {
    expect(
      (await launch({ command: 'codex', launchSource: 'orchestration' })).command
    ).not.toContain('check_for_update_on_startup')
    expect(
      (await launch({ startupAgent: 'claude', launchSource: 'orchestration' })).command
    ).not.toContain('check_for_update_on_startup')
  })

  it('retains explicit permission mode, command overrides, profile and configured environment', async () => {
    const result = await launch(
      undefined,
      createGlobalSettingsFixture({
        agentCmdOverrides: { codex: 'managed-codex' },
        agentDefaultArgs: { codex: '--profile personal --ask-for-approval on-request' },
        agentDefaultEnv: { codex: { CODEX_HOME: '/isolated/codex' } }
      })
    )
    expect(argv(result.command)).toEqual([
      'managed-codex',
      '-c',
      'check_for_update_on_startup=false',
      '--profile',
      'personal',
      '--ask-for-approval',
      'on-request'
    ])
    expect(result.command).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(result.env?.CODEX_HOME).toBe('/isolated/codex')
  })

  it('preserves explicit per-launch arguments and does not mutate caller settings', async () => {
    const settings = createGlobalSettingsFixture({
      agentDefaultArgs: { codex: '--profile untouched' }
    })
    const result = await launch(
      {
        startupAgent: 'codex',
        launchSource: 'orchestration',
        agentArgs: '--model gpt-6.1-sol -c model_reasoning_effort=high'
      },
      settings
    )
    expect(argv(result.command)).toEqual([
      'codex',
      '-c',
      'check_for_update_on_startup=false',
      '--model',
      'gpt-6.1-sol',
      '-c',
      'model_reasoning_effort=high'
    ])
    expect(settings.agentDefaultArgs?.codex).toBe('--profile untouched')
  })

  it('keeps an explicit operator request for startup update checks last', async () => {
    const result = await launch(
      undefined,
      createGlobalSettingsFixture({
        agentDefaultArgs: { codex: '-c check_for_update_on_startup=true' }
      })
    )
    expect(argv(result.command)).toEqual([
      'codex',
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'check_for_update_on_startup=true'
    ])
  })

  it('keeps update policy and approval mode when picked session options replace configured model flags', async () => {
    const result = await launch(
      undefined,
      createGlobalSettingsFixture({
        agentDefaultArgs: {
          codex: '--model configured -c model_reasoning_effort=low --ask-for-approval on-request'
        }
      }),
      'linux',
      true,
      { model: 'gpt-6.1-sol', effort: 'high' }
    )
    const tokens = argv(result.command)
    expect(tokens).toContain('check_for_update_on_startup=false')
    expect(tokens).toContain('gpt-6.1-sol')
    expect(tokens).not.toContain('configured')
    expect(tokens).toContain('model_reasoning_effort=high')
    expect(tokens).not.toContain('model_reasoning_effort=low')
    expect(tokens).toContain('on-request')
    expect(tokens).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })
})
