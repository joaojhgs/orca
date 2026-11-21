import type { WorkspaceSessionState } from '../../../../shared/workspace-session/workspace-session-state-types'
import {
  findTerminalTabIdForLeaf,
  hasHostAuthoritativeTerminalMembership
} from '../../terminal-topology/pane-ownership/terminal-topology-membership'
import type { PersistPtyBindingArgs } from './pty-binding-persistence'

export type SshReattachPtyBinding = Pick<
  PersistPtyBindingArgs,
  'worktreeId' | 'tabId' | 'leafId' | 'ptyId' | 'incarnationId'
>

export function resolveSshReattachPtyBinding(
  binding: SshReattachPtyBinding,
  hostSession: WorkspaceSessionState | undefined,
  legacyLocalSession: WorkspaceSessionState | undefined
): PersistPtyBindingArgs {
  // The leaf survives a move, so use its current tab. Older builds wrote SSH panes to local.
  const legacyTabId = findTerminalTabIdForLeaf(legacyLocalSession, binding.leafId)
  const tabId =
    findTerminalTabIdForLeaf(hostSession, binding.leafId) ?? legacyTabId ?? binding.tabId
  // Missing membership proves a close only after this host owns the worktree's layout.
  const mayCreate =
    !hasHostAuthoritativeTerminalMembership(hostSession, binding.worktreeId) ||
    legacyTabId !== undefined
  return {
    ...binding,
    tabId,
    ...(mayCreate ? {} : { mayCreate: false }),
    mayReviveRetiredSurface: false,
    origin: 'relay_reattach'
  }
}
