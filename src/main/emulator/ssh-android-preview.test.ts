import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { rotateSshProviderAuthority } from '../ssh/ssh-provider-authority'
import {
  dispatchSshAndroidPreview,
  listSshAndroidDevices,
  sshAndroidDeviceId
} from './ssh-android-preview'

const mocks = vi.hoisted(() => ({ observe: vi.fn(), status: 'connected' }))
vi.mock('../execution-observer/observer-client', () => ({
  executionObserverClient: { observe: mocks.observe }
}))
vi.mock('../ssh/ssh-target-registry', () => ({
  listRegisteredSshTargets: () => [{ id: 'personal', label: 'Personal desktop' }],
  getSshConnectionManager: () => ({
    getConnection: (id: string) =>
      id === 'personal' ? { getState: () => ({ status: mocks.status }) } : undefined
  })
}))
let dir = ''
const deviceId = sshAndroidDeviceId('personal', 'USB123')
function writePolicy(enabled = true) {
  writeFileSync(
    join(dir, 'ssh-preview-policy.json'),
    JSON.stringify({
      hosts: enabled ? [{ targetId: 'personal', vnc: [], adb: { usb: true } }] : []
    })
  )
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-ssh-android-'))
  installFakeAppEnvironment({ getPath: () => dir })
  writePolicy()
  mocks.status = 'connected'
  mocks.observe.mockReset()
  mocks.observe.mockResolvedValue({
    devices: [{ serial: 'USB123', label: 'Phone', state: 'device', isEmulator: false }]
  })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
async function attach(worktree: string) {
  const reply = await dispatchSshAndroidPreview('emulator.attach', { device: deviceId, worktree })
  if (!reply.handled || !('attached' in reply.result) || !reply.result.info) {
    throw new Error('Expected attached preview')
  }
  return reply.result.info.streamUrl.slice('remote-adb://'.length)
}
describe('controller Android SSH routing', () => {
  it('replaces only the supplied preview ticket and leaves sibling viewers attached', async () => {
    const replaced = await attach('android-replacement')
    const sibling = await attach('android-sibling')
    const renewed = await dispatchSshAndroidPreview('emulator.attach', {
      device: deviceId,
      previewStream: replaced
    })
    expect(renewed).toMatchObject({ handled: true, result: { attached: true } })
    mocks.observe.mockResolvedValue({ pngBase64: 'iVBORw0KGgo=', width: 10, height: 10 })
    await expect(
      dispatchSshAndroidPreview('emulator.screenshot', { device: replaced })
    ).rejects.toThrow(/expired/)
    await expect(
      dispatchSshAndroidPreview('emulator.screenshot', { device: sibling })
    ).resolves.toMatchObject({ handled: true })
  })
  it('labels the owning host and excludes disconnected/unapproved hosts', async () => {
    await expect(listSshAndroidDevices()).resolves.toEqual([
      expect.objectContaining({
        id: deviceId,
        name: 'Personal desktop · Phone',
        backend: 'android'
      })
    ])
    mocks.status = 'disconnected'
    mocks.observe.mockClear()
    await expect(listSshAndroidDevices()).resolves.toEqual([])
    expect(mocks.observe).not.toHaveBeenCalled()
  })
  it('routes workspace input to its attached device, never the controller', async () => {
    await attach('android-routing-test')
    mocks.observe.mockResolvedValue({ ok: true })
    await expect(
      dispatchSshAndroidPreview('emulator.button', {
        name: 'home',
        worktree: 'android-routing-test'
      })
    ).resolves.toEqual({ handled: true, result: { ok: true } })
    expect(mocks.observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: { kind: 'button', serial: 'USB123', name: 'home' } }),
      expect.anything()
    )
    await expect(
      dispatchSshAndroidPreview('emulator.tap', { x: 0.5, y: 0.5, device: 'local-device' })
    ).resolves.toEqual({ handled: false })
  })
  it('refuses forged host/device identities and unsupported commands without fallback', async () => {
    await expect(
      dispatchSshAndroidPreview('emulator.attach', {
        device: sshAndroidDeviceId('unapproved', 'USB123')
      })
    ).rejects.toThrow(/unavailable/)
    await expect(
      dispatchSshAndroidPreview('emulator.attach', {
        device: sshAndroidDeviceId('personal', 'missing')
      })
    ).rejects.toThrow(/not connected/)
    await expect(dispatchSshAndroidPreview('emulator.exec', { device: deviceId })).rejects.toThrow(
      /not supported/
    )
  })
  it('invalidates streams and workspace controls on SSH reconnection', async () => {
    const streamId = await attach('android-stale-test')
    rotateSshProviderAuthority('personal')
    mocks.observe.mockClear()
    await expect(
      dispatchSshAndroidPreview('emulator.screenshot', { device: streamId })
    ).rejects.toThrow(/expired/)
    await expect(
      dispatchSshAndroidPreview('emulator.button', { worktree: 'android-stale-test', name: 'home' })
    ).rejects.toThrow(/expired/)
    expect(mocks.observe).not.toHaveBeenCalled()
    await expect(
      dispatchSshAndroidPreview('emulator.shutdown', { worktree: 'android-stale-test' })
    ).resolves.toEqual({ handled: true, result: { ok: true } })
    expect(mocks.observe).not.toHaveBeenCalled()
  })
  it('proxies accessibility, launch and bounded logs without local ADB', async () => {
    mocks.observe.mockResolvedValue({
      xml: '<hierarchy><node text="remote" bounds="[0,0][100,50]"/></hierarchy>'
    })
    const ax = await dispatchSshAndroidPreview('emulator.ax', { device: deviceId })
    expect(ax).toMatchObject({ handled: true, result: { children: [{ text: 'remote' }] } })
    mocks.observe.mockResolvedValue({ entries: [{ message: 'remote log' }] })
    await expect(
      dispatchSshAndroidPreview('emulator.logcat', { device: deviceId, lines: 30 })
    ).resolves.toEqual({ handled: true, result: [{ message: 'remote log' }] })
    mocks.observe.mockResolvedValue({ ok: true })
    await dispatchSshAndroidPreview('emulator.launch', {
      device: deviceId,
      package: 'com.example.app'
    })
    expect(mocks.observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: { kind: 'launch', serial: 'USB123', package: 'com.example.app' }
      }),
      expect.anything()
    )
  })
  it('rejects shell injection, global permission reset and excessive logs before dispatch', async () => {
    for (const params of [{ package: 'com.example.app;id' }, { package: '-p' }]) {
      await expect(
        dispatchSshAndroidPreview('emulator.launch', { device: deviceId, ...params })
      ).rejects.toThrow()
    }
    await expect(
      dispatchSshAndroidPreview('emulator.permissions', { device: deviceId, op: 'reset' })
    ).rejects.toThrow()
    await expect(
      dispatchSshAndroidPreview('emulator.logcat', { device: deviceId, lines: 2001 })
    ).rejects.toThrow()
    expect(mocks.observe).not.toHaveBeenCalled()
  })
  it('refuses a result if policy is revoked during the request', async () => {
    mocks.observe.mockImplementation(async () => {
      writePolicy(false)
      return { devices: [] }
    })
    await expect(listSshAndroidDevices()).rejects.toThrow(/expired/)
  })
  it('reports observer failures instead of claiming an empty inventory', async () => {
    mocks.observe.mockResolvedValue({ observerError: 'failed' })
    await expect(listSshAndroidDevices()).rejects.toThrow(/unavailable on its SSH host/)
  })
})
