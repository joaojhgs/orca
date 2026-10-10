import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeSshEmulatorCommands } from './runtime-ssh-emulator-commands'

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('../emulator/ssh-android-preview', () => ({ dispatchSshAndroidPreview: mocks.dispatch }))
const info = {
  deviceUdid: 'ssh-adb:approved',
  streamUrl: 'remote-adb://ssh-adb-stream:ticket',
  wsUrl: '',
  streamCodec: 'mjpeg',
  backend: 'android'
}
beforeEach(() => {
  mocks.dispatch.mockReset()
})

function fixture() {
  const send = vi.fn()
  const resolve = vi.fn(async () => 'folder:registered')
  const cleanup = vi.fn(async () => 'folder:registered')
  const commands = new RuntimeSshEmulatorCommands({
    getEmulatorBridge: () => null,
    getSettings: () => ({}),
    resolveEmulatorWorkspaceId: resolve,
    resolveEmulatorCleanupWorkspaceId: cleanup,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: notification uses only webContents.send.
    getAuthoritativeWindow: () => ({ webContents: { send } }) as never
  })
  return { commands, send, resolve, cleanup }
}
describe('SSH Android workspace attachment', () => {
  it('uses the same canonical workspace for CLI selectors, UI input and notifications', async () => {
    const { commands, send, resolve } = fixture()
    mocks.dispatch.mockResolvedValue({ handled: true, result: { attached: true, info } })
    await commands.emulatorSshPreview('emulator.attach', {
      device: info.deviceUdid,
      worktree: 'id:folder:registered',
      focus: true
    })
    expect(resolve).toHaveBeenCalledWith('id:folder:registered')
    expect(mocks.dispatch).toHaveBeenCalledWith('emulator.attach', {
      device: info.deviceUdid,
      worktree: 'folder:registered',
      focus: true
    })
    expect(send.mock.calls).toEqual([
      ['ui:emulatorAutoAttach', { worktreeId: 'folder:registered', info }],
      ['emulator:pane-focus', { worktreeId: 'folder:registered' }]
    ])
    await commands.emulatorSshPreview('emulator.tap', {
      worktree: 'folder:registered',
      x: 0.5,
      y: 0.5
    })
    expect(mocks.dispatch).toHaveBeenLastCalledWith('emulator.tap', {
      worktree: 'folder:registered',
      x: 0.5,
      y: 0.5
    })
  })
  it('refreshes a ticket without publishing or changing any workspace', async () => {
    const { commands, send, resolve } = fixture()
    mocks.dispatch.mockResolvedValue({ handled: true, result: { attached: true, info } })
    await commands.emulatorSshPreview('emulator.attach', {
      device: info.deviceUdid,
      previewStream: 'old'
    })
    expect(resolve).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it('restores workspace controls on stream renewal without a renderer reattach loop', async () => {
    const { commands, send } = fixture()
    mocks.dispatch.mockResolvedValue({ handled: true, result: { attached: true, info } })
    await commands.emulatorSshPreview('emulator.attach', {
      device: info.deviceUdid,
      worktree: 'id:folder:registered',
      previewStream: 'old'
    })
    expect(mocks.dispatch).toHaveBeenCalledWith('emulator.attach', {
      device: info.deviceUdid,
      worktree: 'folder:registered',
      previewStream: 'old'
    })
    expect(send).not.toHaveBeenCalled()
  })
  it('uses cleanup resolution for deleted workspaces and does not claim failed attachment', async () => {
    const { commands, send, cleanup } = fixture()
    mocks.dispatch.mockResolvedValue({ handled: true, result: { ok: true } })
    await commands.emulatorSshPreview('emulator.shutdown', { worktree: 'id:folder:registered' })
    expect(cleanup).toHaveBeenCalledOnce()
    mocks.dispatch.mockRejectedValue(new Error('Host disconnected'))
    await expect(
      commands.emulatorSshPreview('emulator.attach', { device: info.deviceUdid })
    ).rejects.toThrow('Host disconnected')
    expect(send).not.toHaveBeenCalled()
  })
})
