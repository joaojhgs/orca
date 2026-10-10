import { beforeEach, describe, expect, it, vi } from 'vitest'
const call = vi.hoisted(() => vi.fn())
vi.mock('../runtime-client', async () => {
  const errors = await import('../runtime/types.js')
  return {
    RuntimeClient: class {
      call = call
    },
    RuntimeClientError: errors.RuntimeClientError,
    RuntimeRpcFailureError: errors.RuntimeRpcFailureError
  }
})
import { main } from '../index'
import { okFixture } from '../test-fixtures'
beforeEach(() => {
  vi.restoreAllMocks()
  call.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.exitCode = undefined
})
describe('distributed device CLI', () => {
  it('lists approved VNC targets instead of the controller native desktop', async () => {
    call.mockResolvedValue(okFixture('inventory', { targets: [] }))
    await main(['computer', 'desktops', '--json'], '/worker')
    expect(call).toHaveBeenCalledWith('computer.desktopTargets', { executionHosts: true })
  })
  it('returns inline screenshot bytes that a remote worker can save locally', async () => {
    call.mockResolvedValue(okFixture('capture', { width: 2, height: 1, pngBase64: 'pixels' }))
    await main(['computer', 'desktop-screenshot', '--desktop', 'approved', '--json'], '/worker')
    expect(call).toHaveBeenCalledWith('computer.desktopAction', {
      desktopId: 'approved',
      action: { kind: 'screenshot' }
    })
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])).result).toEqual({
      width: 2,
      height: 1,
      pngBase64: 'pixels'
    })
  })
  it('validates input and emits bounded structured actions without shell commands', async () => {
    call.mockResolvedValue(okFixture('input', { delivered: true, verification: 'unverified' }))
    await main(
      [
        'computer',
        'desktop-input',
        '--desktop',
        'approved',
        '--action',
        'click',
        '--x',
        '4',
        '--y',
        '5',
        '--json'
      ],
      '/worker'
    )
    expect(call).toHaveBeenCalledWith('computer.desktopAction', {
      desktopId: 'approved',
      action: { kind: 'click', x: 4, y: 5, button: 'left', count: 1 }
    })
    call.mockClear()
    await main(
      [
        'computer',
        'desktop-input',
        '--desktop',
        'approved',
        '--action',
        'key',
        '--key',
        'A',
        '--x',
        '4'
      ],
      '/worker'
    )
    expect(call).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
  it('requests cross-host Android discovery by default and preserves local-only mode', async () => {
    call.mockResolvedValue(okFixture('devices', []))
    await main(['emulator', 'devices', '--worktree', 'all', '--json'], '/worker')
    expect(call).toHaveBeenCalledWith('emulator.listDevices', {
      worktree: undefined,
      executionHosts: true
    })
    call.mockClear()
    await main(['emulator', 'devices', '--worktree', 'all', '--local-only', '--json'], '/worker')
    expect(call).toHaveBeenCalledWith('emulator.listDevices', { worktree: undefined })
  })
  it('routes Android screenshots to the explicit qualified device', async () => {
    call.mockResolvedValue(okFixture('image', { pngBase64: 'pixels' }))
    await main(
      ['emulator', 'screenshot', '--device', 'ssh-adb:test', '--worktree', 'all', '--json'],
      '/worker'
    )
    expect(call).toHaveBeenCalledWith('emulator.agentScreenshot', {
      device: 'ssh-adb:test',
      emulator: undefined,
      worktree: undefined
    })
  })
})
