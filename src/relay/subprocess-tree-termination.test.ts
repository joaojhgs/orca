import * as ChildProcessModule from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return { ...actual, execFile: vi.fn() }
})

import { terminateRelaySubprocessTree } from './subprocess-tree-termination'

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  vi.mocked(ChildProcessModule.execFile).mockReset()
  vi.unstubAllEnvs()
})

describe('terminateRelaySubprocessTree', () => {
  it('invokes System32 taskkill without a shell command', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    const child = new ChildProcessModule.ChildProcess()
    Object.defineProperty(child, 'pid', { value: 12345 })
    const kill = vi.spyOn(child, 'kill')

    terminateRelaySubprocessTree(child)

    expect(ChildProcessModule.execFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', '12345', '/T', '/F'],
      expect.any(Function)
    )
    expect(kill).not.toHaveBeenCalled()
  })
})
