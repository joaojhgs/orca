import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { discoverExecutionCredentials } from './credential-discovery'
import { parseClaudeOAuthCredentialsJson } from '../rate-limits/claude-oauth-credentials'
import { metadataForClaudeUsageAttempt } from '../rate-limits/claude-usage-result'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('node:os', () => ({ homedir: () => '/fixture' }))
vi.mock('node:fs', () => ({
  statSync: () => ({ size: 128 }),
  readFileSync: (file: unknown) => {
    const content = files.get(String(file))
    if (content === undefined) {
      throw new Error('Fixture file unavailable')
    }
    return content
  }
}))
vi.mock('../rate-limits/cursor-auth', () => ({
  readCursorAuthSession: async () => ({ status: 'missing' })
}))
afterEach(() => {
  files.clear()
  vi.unstubAllEnvs()
})

describe('Claude execution-source identity', () => {
  it('binds selected usage to the local credential without exporting its token', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined)
    const token = 'fixture-access-token'
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: token } })
    files.set(join('/fixture', '.claude', '.credentials.json'), raw)
    files.set(
      join('/fixture', '.claude.json'),
      JSON.stringify({
        oauthAccount: {
          accountUuid: 'fixture-account',
          organizationUuid: 'fixture-organization'
        }
      })
    )
    const [credential] = await discoverExecutionCredentials()
    const metadata = metadataForClaudeUsageAttempt({
      attemptedSources: ['oauth'],
      oauthCredentials: parseClaudeOAuthCredentialsJson(raw, 'credentials-file')
    })
    expect(credential).toMatchObject({ provider: 'claude', identityConfidence: 'account' })
    expect(credential?.credentialRevision).toBe(metadata.executionCredentialRevision)
    expect(credential?.credentialRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify({ credential, metadata })).not.toContain(token)
  })
})
