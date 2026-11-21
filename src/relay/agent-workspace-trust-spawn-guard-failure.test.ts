import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../shared/agent-launch/permissions/workspace-pretrust-scope', () => ({
  isTooBroadToPreTrust: () => {
    throw new Error('homedir unavailable')
  }
}))

import { applyRelayAgentWorkspaceTrust } from './agent-workspace-trust-spawn'

describe('applyRelayAgentWorkspaceTrust when the breadth guard fails', () => {
  it.each(['claude', 'copilot', 'qoder'] as const)(
    'skips %s trust and never fails the spawn',
    async (agent) => {
      const home = await mkdtemp(join(tmpdir(), 'orca-relay-trust-guard-'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await expect(
          applyRelayAgentWorkspaceTrust(
            { workspacePath: join(home, 'workspace') },
            agent,
            { HOME: home, USERPROFILE: home },
            { wslShell: false }
          )
        ).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('the agent will ask'),
          new Error('homedir unavailable')
        )
        expect(await readdir(home)).toEqual([])
      } finally {
        warn.mockRestore()
        await rm(home, { recursive: true, force: true })
      }
    }
  )
})
