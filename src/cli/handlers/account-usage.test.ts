import { describe, expect, it, vi } from 'vitest'
import { main } from '../index'
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
