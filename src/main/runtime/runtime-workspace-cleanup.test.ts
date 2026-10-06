import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeWorkspaceCleanup } from './runtime-workspace-cleanup'
import { scanWorkspaceCleanup } from '../ipc/workspace-cleanup-scan'
import { persistWorkspaceCleanupScanResult } from '../workspace-cleanup-scan-snapshot'

vi.mock('../ipc/workspace-cleanup-scan', () => ({ scanWorkspaceCleanup: vi.fn() }))
vi.mock('../workspace-cleanup-scan-snapshot', () => ({
  persistWorkspaceCleanupScanResult: vi.fn(async () => {}),
  readWorkspaceCleanupScanSnapshot: vi.fn(async () => null)
}))
const store = { getProfileStorageDirectory: () => '/test/profile' }
const result = { scannedAt: 1, candidates: [], errors: [] }

function createService(): RuntimeWorkspaceCleanup {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Scanner and persistence are mocked; these scan-only tests use only the verified profile-directory seam.
  return new RuntimeWorkspaceCleanup(store as never)
}

describe('paired cleanup scan ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('persists broad results but never overwrites them with a focused empty scan', async () => {
    vi.mocked(scanWorkspaceCleanup).mockResolvedValue(result)
    const service = createService()
    await service.control({ operation: 'scan', args: { includeAllWorkspaces: true } }, 'browser')
    expect(persistWorkspaceCleanupScanResult).toHaveBeenCalledTimes(1)
    await service.control({ operation: 'scan', args: { worktreeIds: [] } }, 'browser')
    expect(persistWorkspaceCleanupScanResult).toHaveBeenCalledTimes(1)
  })
  it('isolates cancellation and progress between paired devices', async () => {
    let finish!: (value: typeof result) => void
    let signal: AbortSignal | undefined
    vi.mocked(scanWorkspaceCleanup).mockImplementation((_store, _args, options) => {
      signal = options?.signal
      options?.onProgress?.({
        ...result,
        scanId: 'same',
        scannedWorktreeCount: 1,
        totalWorktreeCount: 2,
        candidateMode: 'append'
      })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const service = createService()
    const scan = service.control({ operation: 'scan', args: { scanId: 'same' } }, 'browser-a')
    await expect(
      service.control({ operation: 'cancelScan', scanId: 'same' }, 'browser-b')
    ).resolves.toBe(false)
    await expect(
      service.control({ operation: 'getProgress', scanId: 'same' }, 'browser-b')
    ).resolves.toBeNull()
    await expect(
      service.control({ operation: 'getProgress', scanId: 'same' }, 'browser-a')
    ).resolves.toMatchObject({ candidateMode: 'snapshot', scannedWorktreeCount: 1 })
    await service.control({ operation: 'cancelScan', scanId: 'same' }, 'browser-a')
    expect(signal?.aborted).toBe(true)
    finish(result)
    await expect(scan).rejects.toThrow('Workspace cleanup scan cancelled')
    await expect(
      service.control({ operation: 'getProgress', scanId: 'same' }, 'browser-a')
    ).resolves.toBeNull()
  })
})
