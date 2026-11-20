import { describe, expect, it, vi } from 'vitest'
import { main } from '../index'
import { ORCA_SSH_BRIDGE_CREDENTIAL_ENV } from '../../shared/ssh-bridge-credential-env'
const mocks = vi.hoisted(() => ({ call: vi.fn(), constructor: vi.fn() }))
vi.mock('../runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('../index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock: mocks.call,
    runtimeClientConstructorMock: mocks.constructor,
    serveOrcaAppMock: vi.fn(),
    getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data')
  })
})
vi.mock('../runtime/environments', () => ({
  listEnvironments: () => [{ id: 'skyron-host', name: 'skyron-host' }],
  resolveEnvironment: () => ({ id: 'skyron-host', name: 'skyron-host' })
}))

describe('account usage CLI routing', () => {
  it('reaches the runtime from an SSH bridge instead of the owner-machine guard', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv(ORCA_SSH_BRIDGE_CREDENTIAL_ENV, 'sshb_usage_test')
    mocks.call.mockClear()
    mocks.call.mockResolvedValue({
      id: 'ssh-usage',
      ok: true,
      result: { rateLimits: { executionAccounts: [] } }
    })
    try {
      await main(['account', 'usage', '--all-hosts', '--json'], '/tmp')
      expect(mocks.call).toHaveBeenCalledWith('accounts.usage', undefined, { timeoutMs: 120000 })
      const result = JSON.parse(log.mock.calls.at(-1)![0])
      expect(result.result.scope).toEqual({ mode: 'all', executionHostId: null })
    } finally {
      vi.unstubAllEnvs()
      log.mockRestore()
      process.exitCode = 0
    }
  })
  it('honors the explicitly selected server instead of silently reading the local one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.call.mockResolvedValue({
      id: 'usage',
      ok: true,
      result: { rateLimits: { executionAccounts: [] } }
    })
    try {
      await main(['account', 'usage', '--environment', 'skyron-host', '--json'], '/tmp')
      expect(mocks.constructor).toHaveBeenCalledWith(undefined, 'skyron-host')
      expect(mocks.call).toHaveBeenCalledWith('accounts.usage', undefined, { timeoutMs: 120000 })
    } finally {
      log.mockRestore()
      process.exitCode = 0
    }
  })
})
