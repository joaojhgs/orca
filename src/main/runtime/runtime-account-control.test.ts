import { beforeEach, describe, expect, it, vi } from 'vitest'
import { controlRuntimeAccount } from './runtime-account-control'
import type { RuntimeAccountServices } from './runtime-account-controller'

const stores = vi.hoisted(() => ({
  goConfigured: false,
  planConfigured: false,
  saveGo: vi.fn(),
  clearGo: vi.fn(),
  savePlan: vi.fn(),
  clearPlan: vi.fn()
}))
vi.mock('../cursor-accounts/status', () => ({ getCursorAccountStatus: vi.fn() }))
vi.mock('../grok-accounts/status', () => ({ getGrokAccountStatus: vi.fn() }))
vi.mock('../minimax/minimax-credentials-status', () => ({ getMiniMaxCredentialsStatus: vi.fn() }))
vi.mock('../minimax/minimax-cookie-store', () => ({
  clearMiniMaxSessionCookie: vi.fn(),
  saveMiniMaxSessionCookie: vi.fn()
}))
vi.mock('../minimax/minimax-api-key-store', () => ({
  clearMiniMaxApiKey: vi.fn(),
  saveMiniMaxApiKey: vi.fn()
}))
vi.mock('../rate-limits/minimax/minimax-request-context', () => ({
  clearMiniMaxSessionCookieJar: vi.fn()
}))
vi.mock('../codex/codex-pane-account-registry', () => ({ listRecordedCodexPaneLanes: vi.fn() }))
vi.mock('../codex/codex-stale-pane-accounts', () => ({
  forgetStaleCodexPanes: vi.fn(),
  listStaleCodexPanes: vi.fn()
}))
vi.mock('../opencode/opencode-go-api-key-store', () => ({
  hasOpenCodeGoApiKey: () => stores.goConfigured,
  saveOpenCodeGoApiKey: stores.saveGo,
  clearOpenCodeGoApiKey: stores.clearGo
}))
vi.mock('../zcode/zcode-plan-api-key-store', () => ({
  hasZcodePlanApiKey: () => stores.planConfigured,
  saveZcodePlanApiKey: stores.savePlan,
  clearZcodePlanApiKey: stores.clearPlan,
  getZcodePlanApiKeyProtection: () => 'sealed'
}))
vi.mock('../rate-limits/zcode-usage-fetcher', () => ({ hasZcodeCliPlanCredentials: () => true }))

const rateLimits = {
  invalidateOpenCodeGoCredentialState: vi.fn(),
  invalidateZcodeCredentialState: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined)
}
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: These credential operations only access the three rate-limit methods mocked above.
const services = { rateLimits } as unknown as RuntimeAccountServices

beforeEach(() => {
  vi.clearAllMocks()
  stores.goConfigured = false
  stores.planConfigured = false
  stores.saveGo.mockImplementation(() => {
    stores.goConfigured = true
  })
  stores.clearGo.mockImplementation(() => {
    stores.goConfigured = false
  })
  stores.savePlan.mockImplementation(() => {
    stores.planConfigured = true
  })
  stores.clearPlan.mockImplementation(() => {
    stores.planConfigured = false
  })
})

describe('paired browser secure quota credentials', () => {
  it('reads persisted status without exposing keys or refreshing usage', async () => {
    expect(await controlRuntimeAccount(services, { operation: 'opencodeGo.status' })).toEqual({
      apiKeyConfigured: false
    })
    expect(await controlRuntimeAccount(services, { operation: 'zcodePlan.status' })).toEqual({
      apiKeyConfigured: false,
      zcodeCliConfigured: true,
      apiKeyProtection: 'sealed'
    })
    expect(rateLimits.refresh).not.toHaveBeenCalled()
  })

  it('stores and clears OpenCode Go overrides using upstream credential invalidation', async () => {
    const result = await controlRuntimeAccount(services, {
      operation: 'opencodeGo.saveApiKey',
      secret: 'fixture-go-key'
    })
    expect(stores.saveGo).toHaveBeenCalledWith('fixture-go-key')
    expect(result).toEqual({ apiKeyConfigured: true })
    expect(rateLimits.invalidateOpenCodeGoCredentialState).toHaveBeenLastCalledWith({
      apiKeyCleared: false
    })
    expect(await controlRuntimeAccount(services, { operation: 'opencodeGo.clearApiKey' })).toEqual({
      apiKeyConfigured: false
    })
    expect(stores.clearGo).toHaveBeenCalledOnce()
    expect(rateLimits.invalidateOpenCodeGoCredentialState).toHaveBeenLastCalledWith({
      apiKeyCleared: true
    })
    expect(rateLimits.refresh).toHaveBeenCalledTimes(2)
  })

  it('stores and clears saved GLM plans without returning the key', async () => {
    const result = await controlRuntimeAccount(services, {
      operation: 'zcodePlan.saveApiKey',
      secret: 'fixture-plan-key'
    })
    expect(stores.savePlan).toHaveBeenCalledWith('fixture-plan-key')
    expect(result).toMatchObject({ apiKeyConfigured: true })
    expect(JSON.stringify(result)).not.toContain('fixture-plan-key')
    expect(
      await controlRuntimeAccount(services, { operation: 'zcodePlan.clearApiKey' })
    ).toMatchObject({ apiKeyConfigured: false })
    expect(stores.clearPlan).toHaveBeenCalledOnce()
    expect(rateLimits.invalidateZcodeCredentialState).toHaveBeenCalledTimes(2)
    expect(rateLimits.refresh).toHaveBeenCalledTimes(2)
  })
})
