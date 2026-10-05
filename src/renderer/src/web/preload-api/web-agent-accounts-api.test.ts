import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createClaudeAccountsApi,
  createCodexAccountsApi,
  createCursorAccountsApi,
  createMiniMaxCredentialsApi,
  createOpenCodeGoCredentialsApi,
  createZcodePlanCredentialsApi
} from './web-agent-accounts-api'
import { AccountControlParams } from '../../../../shared/rpc-contract/accounts-params'
const mocks = vi.hoisted(() => ({ call: vi.fn(), owner: 'server-one' }))
vi.mock('./web-runtime-calls', () => ({ callRuntimeResult: mocks.call }))
vi.mock('./web-runtime-session', () => ({
  requireActiveEnvironmentOrNull: () => ({ id: mocks.owner })
}))

describe('browser account APIs', () => {
  it.each([
    ['opencodeGo', createOpenCodeGoCredentialsApi],
    ['zcodePlan', createZcodePlanCredentialsApi]
  ] as const)(
    'routes %s credentials through paired account controls',
    async (provider, createApi) => {
      const api = createApi()
      mocks.call.mockResolvedValue({ apiKeyConfigured: true })
      await api.getStatus()
      expect(mocks.call).toHaveBeenLastCalledWith(
        'accounts.control',
        { operation: `${provider}.status` },
        60000
      )
      await api.saveApiKey('placeholder-key')
      const operation = `${provider}.saveApiKey`
      expect(mocks.call).toHaveBeenLastCalledWith(
        'accounts.control',
        { operation, secret: 'placeholder-key' },
        60000
      )
      expect(AccountControlParams.safeParse({ operation, secret: 'placeholder-key' }).success).toBe(
        true
      )
      expect(AccountControlParams.safeParse({ operation, secret: 'x'.repeat(16385) }).success).toBe(
        false
      )
      await api.clearApiKey()
      expect(mocks.call).toHaveBeenLastCalledWith(
        'accounts.control',
        { operation: `${provider}.clearApiKey` },
        60000
      )
    }
  )
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.owner = 'server-one'
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())
  it('lists real managed accounts and routes credential/status controls', async () => {
    mocks.call.mockResolvedValue({ claude: { accounts: [{ id: 'claude-one' }] } })
    expect(await createClaudeAccountsApi().list()).toEqual({ accounts: [{ id: 'claude-one' }] })
    expect(mocks.call).toHaveBeenCalledWith('accounts.list', { refreshUsage: false })
    await createCursorAccountsApi().getStatus()
    expect(mocks.call).toHaveBeenLastCalledWith(
      'accounts.control',
      { operation: 'cursor.status' },
      60000
    )
    await createMiniMaxCredentialsApi().saveApiKey('placeholder-key')
    expect(mocks.call).toHaveBeenLastCalledWith(
      'accounts.control',
      { operation: 'minimax.saveApiKey', secret: 'placeholder-key' },
      60000
    )
  })
  it('does not publish a pending login URL after switching servers', async () => {
    let resolve: (url: string) => void = () => {}
    mocks.call.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    const callback = vi.fn()
    const unsubscribe = createCodexAccountsApi().onPendingLoginUrlChanged(callback)
    mocks.owner = 'server-two'
    resolve('https://example.test/login')
    await vi.advanceTimersByTimeAsync(5000)
    expect(callback).not.toHaveBeenCalled()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
  it('stops login URL polling after unsubscribe', async () => {
    mocks.call.mockResolvedValue(null)
    const callback = vi.fn()
    const unsubscribe = createCodexAccountsApi().onPendingLoginUrlChanged(callback)
    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledWith(null)
    unsubscribe()
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
})
