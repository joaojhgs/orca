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
  vi.unstubAllGlobals()
})

describe('OpenCode account identity', () => {
  function copilot(token: string) {
    vi.stubEnv('XDG_DATA_HOME', '/fixture/data')
    files.set(
      '/fixture/data/opencode/auth.json',
      JSON.stringify({ 'github-copilot': { type: 'oauth', refresh: token, access: token } })
    )
    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy'
    ]) {
      vi.stubEnv(name, undefined)
    }
  }

  it('groups different Copilot tokens using GitHub’s stable user ID without exporting identity or secrets', async () => {
    const request = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: 123, login: 'fixture-user' }))
      )
    vi.stubGlobal('fetch', request)
    copilot('first-secret')
    const [first] = await discoverExecutionCredentials()
    copilot('second-secret')
    const [second] = await discoverExecutionCredentials()
    expect(first?.identityConfidence).toBe('account')
    expect(first?.accountKey).toBe(second?.accountKey)
    expect(first?.credentialRevision).not.toBe(second?.credentialRevision)
    expect(JSON.stringify([first, second])).not.toMatch(/first-secret|second-secret|fixture-user/)
  })

  it('fails identity closed and skips network when only validating credential revisions', async () => {
    copilot('fixture-secret')
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', request)
    expect((await discoverExecutionCredentials())[0]?.identityConfidence).toBe('unknown')
    request.mockClear()
    expect(
      (await discoverExecutionCredentials({ resolveProviderIdentity: false }))[0]
        ?.credentialRevision
    ).toMatch(/^[a-f0-9]{64}$/)
    expect(request).not.toHaveBeenCalled()
  })
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
