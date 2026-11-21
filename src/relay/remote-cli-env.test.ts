import { describe, expect, it } from 'vitest'
import { pickRemoteCliEnv } from './remote-cli-env'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('pickRemoteCliEnv', () => {
  it('forwards SSH Orca terminal and worktree context for remote CLI calls', () => {
    expect(
      pickRemoteCliEnv({
        ORCA_TERMINAL_HANDLE: 'term_ssh',
        ORCA_WORKTREE_ID: 'repo::remote',
        ORCA_PANE_KEY: 'pane-1',
        ORCA_AGENT_LAUNCH_TOKEN: 'launch-secret',
        ORCA_WORKSPACE_ID: 'workspace-1',
        ORCA_USER_DATA_PATH: '/tmp/orca',
        PATH: '/usr/bin',
        SECRET_TOKEN: 'nope'
      })
    ).toEqual({
      ORCA_TERMINAL_HANDLE: 'term_ssh',
      ORCA_WORKTREE_ID: 'repo::remote',
      ORCA_PANE_KEY: 'pane-1',
      ORCA_AGENT_LAUNCH_TOKEN: 'launch-secret',
      ORCA_WORKSPACE_ID: 'workspace-1',
      ORCA_USER_DATA_PATH: '/tmp/orca',
      PATH: '/usr/bin'
    })
  })
  it('resolves the private service file on its own execution host without forwarding the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-manager-relay-test-'))
    const credentialFile = join(dir, 'credential.json')
    const token = `orcam_${'a'.repeat(43)}`
    try {
      writeFileSync(credentialFile, JSON.stringify({ serviceToken: token }), { mode: 0o600 })
      expect(pickRemoteCliEnv({ ORCA_MANAGER_CREDENTIAL_FILE: credentialFile })).toEqual({
        ORCA_MANAGER_TOKEN: token
      })
      if (process.platform !== 'win32') {
        chmodSync(credentialFile, 0o644)
        expect(() => pickRemoteCliEnv({ ORCA_MANAGER_CREDENTIAL_FILE: credentialFile })).toThrow(
          'private'
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('fails closed on an explicitly empty service credential', () => {
    expect(() => pickRemoteCliEnv({ ORCA_MANAGER_TOKEN: '' })).toThrow('not configured')
  })
})
