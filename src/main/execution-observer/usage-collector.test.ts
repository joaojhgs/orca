import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectExecutionUsage } from './usage-collector'
import type { ExecutionCredential } from '../../shared/execution-observer'

const credential: ExecutionCredential = {
  provider: 'codex',
  sourceRef: 'codex:default',
  accountKey: 'a'.repeat(64),
  identityConfidence: 'account'
}
const mocks = vi.hoisted(() => ({ discover: vi.fn() }))
vi.mock('./credential-discovery', () => ({
  discoverExecutionCredentials: mocks.discover,
  credentialPaths: () => ({ codexHome: '/test' }),
  readCredentialRecord: vi.fn(),
  record: vi.fn(),
  text: vi.fn()
}))
vi.mock('../rate-limits/codex-backend-usage-client', () => ({
  fetchCodexRateLimitsViaBackend: async (request: typeof fetch) => {
    await request('https://chatgpt.com/backend-api/wham/usage')
    return {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: 1,
      status: 'ok',
      error: null
    }
  }
}))

describe('execution-host request policy', () => {
  beforeEach(() => {
    mocks.discover.mockResolvedValue([credential])
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  it('makes real requests when the proxy validator reports no proxy', async () => {
    const request = globalThis.fetch
    expect(await collectExecutionUsage(credential)).toMatchObject({ status: 'ok' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toBe(request)
  })
  it('fails closed instead of bypassing a configured execution-host proxy', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:8080')
    const request = globalThis.fetch
    expect(await collectExecutionUsage(credential)).toMatchObject({ status: 'error' })
    expect(request).not.toHaveBeenCalled()
    expect(globalThis.fetch).toBe(request)
  })
  it('preserves Retry-After without exposing the provider response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('secret response', {
          status: 429,
          headers: { 'Retry-After': '60' }
        })
      )
    )
    const result = await collectExecutionUsage(credential)
    expect(result).toMatchObject({
      status: 'error',
      usageMetadata: { failureKind: 'rate-limited' }
    })
    expect(result.usageMetadata?.retryAtMs).toBeGreaterThan(Date.now())
    expect(JSON.stringify(result)).not.toContain('secret response')
  })
})
