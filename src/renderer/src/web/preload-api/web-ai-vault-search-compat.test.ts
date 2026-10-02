import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchResults } from '../../../../shared/ai-vault-search-test-fixture'
import { unavailableSessionSearchStatus } from '../../../../shared/ai-vault-search-client'

const callRuntimeResult = vi.hoisted(() => vi.fn())
vi.mock('./web-runtime-calls', () => ({ callRuntimeResult }))
vi.mock('./web-runtime-session', () => ({
  requireActiveEnvironment: () => ({ id: 'owning-host' })
}))
import { createWebAiVaultApi } from './web-ai-vault-api'

beforeEach(() => {
  callRuntimeResult.mockReset()
})

describe('web session search preload compatibility', () => {
  it('calls the selected host, parses its response and applies remote exposure', async () => {
    callRuntimeResult.mockResolvedValue(searchResults())
    const api = createWebAiVaultApi()
    const result = await api.searchSessions({ query: 'needle' })
    expect(callRuntimeResult).toHaveBeenCalledExactlyOnceWith('aiVault.searchSessions', {
      query: 'needle',
      limit: 20
    })
    expect(result).toMatchObject({ kind: 'results', hits: [{ source: { presence: 'present' } }] })
    expect(JSON.stringify(result)).not.toContain('resumeCommand')
    expect(result).not.toHaveProperty('debug')
    callRuntimeResult.mockResolvedValue(unavailableSessionSearchStatus())
    expect(await api.searchStatus()).toEqual(unavailableSessionSearchStatus())
    expect(callRuntimeResult).toHaveBeenLastCalledWith('aiVault.searchStatus', {})
  })
  it('treats an old host as unavailable but propagates transport failures', async () => {
    const api = createWebAiVaultApi()
    callRuntimeResult.mockRejectedValue(
      Object.assign(new Error('unknown method'), { code: 'method_not_found' })
    )
    expect(await api.searchSessions({ query: 'needle' })).toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    expect(await api.searchStatus()).toEqual(unavailableSessionSearchStatus())
    callRuntimeResult.mockRejectedValue(
      Object.assign(new Error('disconnected'), { code: 'connection_lost' })
    )
    await expect(api.searchSessions({ query: 'needle' })).rejects.toThrow('disconnected')
    await expect(api.searchStatus()).rejects.toThrow('disconnected')
  })
  it('rejects invalid host responses', async () => {
    const api = createWebAiVaultApi()
    callRuntimeResult.mockResolvedValue({ kind: 'results' })
    await expect(api.searchSessions({ query: 'needle' })).rejects.toThrow()
    await expect(api.searchStatus()).rejects.toThrow()
  })
  it('answers for its own runtime and reports any other host unavailable', async () => {
    const api = createWebAiVaultApi()
    callRuntimeResult.mockResolvedValue(searchResults())
    for (const scope of ['runtime:owning-host'] as const) {
      expect(await api.searchSessions({ query: 'needle' }, scope)).toMatchObject({
        kind: 'results'
      })
    }
    expect(callRuntimeResult).toHaveBeenCalledTimes(1)
    callRuntimeResult.mockClear()
    for (const scope of ['runtime:other-host'] as const) {
      expect(await api.searchSessions({ query: 'needle' }, scope)).toEqual({
        kind: 'unavailable',
        reason: 'no-service'
      })
      expect(await api.searchStatus(scope)).toEqual(unavailableSessionSearchStatus())
    }
    callRuntimeResult.mockResolvedValue({ capabilities: [] })
    expect(await api.searchSessions({ query: 'needle' }, 'all')).toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    expect(callRuntimeResult).toHaveBeenCalledExactlyOnceWith('status.get', undefined, 15000)
  })
  it('routes SSH search and titles only when the paired server advertises host routing', async () => {
    const api = createWebAiVaultApi()
    callRuntimeResult.mockImplementation(async (method) =>
      method === 'status.get'
        ? { capabilities: ['aiVault.execution-hosts.v1'] }
        : method === 'aiVault.resolveSessionTitles'
          ? { titles: [] }
          : searchResults()
    )
    await expect(api.searchSessions({ query: 'needle' }, 'ssh:box')).resolves.toMatchObject({
      kind: 'results'
    })
    expect(callRuntimeResult).toHaveBeenCalledWith('aiVault.searchSessions', {
      query: 'needle',
      limit: 20,
      executionHostScope: 'ssh:box'
    })
    await api.resolveSessionTitles({ executionHostScope: 'ssh:box', requests: [] })
    expect(callRuntimeResult).toHaveBeenCalledWith('aiVault.resolveSessionTitles', {
      requests: [],
      executionHostScope: 'ssh:box'
    })
    callRuntimeResult.mockReset().mockResolvedValue({ capabilities: [] })
    await expect(api.searchSessions({ query: 'needle' }, 'ssh:box')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    expect(callRuntimeResult).toHaveBeenCalledTimes(1)
  })
  it('preserves SSH scopes for list requests and forwards unlimited depth', async () => {
    const api = createWebAiVaultApi()
    const result = { sessions: [], issues: [], scannedAt: '2026-10-02T00:00:00Z' }
    callRuntimeResult.mockImplementation(async (method) =>
      method === 'status.get' ? { capabilities: ['aiVault.execution-hosts.v1'] } : result
    )
    expect(
      await api.listSessions({
        executionHostScope: 'ssh:box',
        unlimited: true,
        scopePaths: ['/srv/project']
      })
    ).toEqual(result)
    expect(callRuntimeResult).toHaveBeenCalledWith(
      'aiVault.listSessions',
      expect.objectContaining({
        executionHostScope: 'ssh:box',
        unlimited: true,
        scopePaths: ['/srv/project'],
        executionHostId: 'runtime:owning-host'
      })
    )
  })
})
