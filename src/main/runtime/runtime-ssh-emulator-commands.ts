import { dispatchSshAndroidPreview } from '../emulator/ssh-android-preview'
import { getRuntimeDesktopSurface } from './construction/runtime-desktop-surface'
import type { RuntimeEmulatorCommandHost } from './emulator/runtime-emulator-commands'

export class RuntimeSshEmulatorCommands {
  constructor(private readonly host: RuntimeEmulatorCommandHost) {}

  async emulatorSshPreview(
    method: string,
    params: Parameters<typeof dispatchSshAndroidPreview>[1] & { focus?: boolean }
  ) {
    const closing = ['emulator.kill', 'emulator.shutdown', 'emulator.unregisterActive'].includes(
      method
    )
    const worktree = params.worktree
      ? await (closing
          ? this.host.resolveEmulatorCleanupWorkspaceId(params.worktree)
          : this.host.resolveEmulatorWorkspaceId(params.worktree))
      : undefined
    const remote = await dispatchSshAndroidPreview(method, { ...params, worktree })
    if (
      remote.handled &&
      method === 'emulator.attach' &&
      'attached' in remote.result &&
      worktree &&
      !params.previewStream
    ) {
      try {
        const windowId = this.host.getAuthoritativeWindowId()
        const desktop = getRuntimeDesktopSurface()
        desktop.sendToWindow(windowId, 'ui:emulatorAutoAttach', {
          worktreeId: worktree,
          info: remote.result.info
        })
        if (params.focus) {
          desktop.sendToWindow(windowId, 'emulator:pane-focus', { worktreeId: worktree })
        }
      } catch {
        // The browser may be the only connected viewer on a headless runtime.
      }
    }
    return remote
  }
}
