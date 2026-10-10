import { parseExecutionHostId } from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Worktree } from '../../../../shared/worktree/types'
import type { MergeContext } from './resource-usage-merge-types'

/** Folder catalog row for host/name attribution; a duplicated id cannot choose a host, so it yields nothing. */
export function resolveResourceFolderWorkspace(
  ctx: MergeContext,
  worktreeId: string
): Worktree | undefined {
  if (
    parseWorkspaceKey(worktreeId)?.type !== 'folder' ||
    ctx.ambiguousWorktreeIds?.has(worktreeId)
  ) {
    return undefined
  }
  return ctx.worktreeById?.get(worktreeId)
}

export function resolveResourceWorkspaceHost(
  ctx: MergeContext,
  worktreeId: string,
  repoId: string
): { isRemote: boolean; runtimeHostId: string | null } {
  const folder = resolveResourceFolderWorkspace(ctx, worktreeId)
  const host = folder ? parseExecutionHostId(folder.hostId ?? 'local') : null
  return {
    // Folder siblings may execute on different hosts within the same project group.
    isRemote: host ? host.kind === 'ssh' : ctx.repoConnectionIdById.get(repoId) != null,
    runtimeHostId: host
      ? host.kind === 'runtime'
        ? host.id
        : null
      : (ctx.repoRuntimeHostIdById?.get(repoId) ??
        (ctx.repoRuntimeEnvironmentIdById?.get(repoId)
          ? `runtime:${ctx.repoRuntimeEnvironmentIdById.get(repoId)}`
          : ctx.repoRuntimeScopedById?.get(repoId)
            ? 'runtime:unknown'
            : null))
  }
}

/** Local samples cannot leak into peer rows; web samples can describe only their paired owner. */
export function ownsRuntimeResourceSample(
  ctx: MergeContext,
  worktreeId: string,
  repoId: string,
  environmentId?: string
): boolean {
  if (!environmentId) {
    return false
  }
  const worktree = ctx.ambiguousWorktreeIds?.has(worktreeId)
    ? undefined
    : ctx.worktreeById?.get(worktreeId)
  const host = parseExecutionHostId(worktree?.hostId)
  const owner =
    worktree?.runtimeOwnerEnvironmentId ??
    (host?.kind === 'runtime' ? host.environmentId : ctx.repoRuntimeEnvironmentIdById?.get(repoId))
  return owner === environmentId
}

export function resourceWorktreeKey(worktreeId: string, executionHostId?: string): string {
  return executionHostId ? `${executionHostId}\0${worktreeId}` : worktreeId
}
