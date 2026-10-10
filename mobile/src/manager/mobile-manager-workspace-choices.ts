import { z } from 'zod'
import { parseExecutionHostId } from '../../../src/shared/execution-host'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../../src/shared/workspace-scope'
import type { RpcClient } from '../transport/rpc-client'
import { worktreeCatalogRead } from '../worktree/worktree-catalog-operations'
import { WORKTREE_PS_FULL_LIMIT } from '../worktree/worktree-catalog-snapshot-client'

const workspaceRow = z.looseObject({
  worktreeId: z.string().min(1),
  displayName: z.string().min(1),
  hostId: z.string().optional(),
  isArchived: z.boolean(),
  removing: z.boolean().optional()
})
const workspacePage = z.looseObject({
  worktrees: z.array(workspaceRow),
  truncated: z.boolean()
})
export type MobileManagerWorkspaceChoice = { id: string; label: string }

export function mobileManagerWorkspaceChoices(input: unknown): MobileManagerWorkspaceChoice[] {
  const page = workspacePage.parse(input)
  if (page.truncated) {
    throw new Error(
      'Workspace catalog is truncated. Narrow it before assigning a manager objective.'
    )
  }
  const unique = new Map<string, MobileManagerWorkspaceChoice | null>()
  for (const row of page.worktrees) {
    if (row.isArchived || row.removing || parseExecutionHostId(row.hostId)?.kind === 'runtime') {
      continue
    }
    const id = normalizeWorkspaceSessionKeyToWorkspaceId(row.worktreeId)
    const choice = { id, label: `${row.displayName} · ${row.hostId ?? 'local'}` }
    unique.set(id, unique.has(id) ? null : choice)
  }
  return [...unique.values()]
    .filter((choice) => choice !== null)
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function readMobileManagerWorkspaces(
  client: RpcClient
): Promise<MobileManagerWorkspaceChoice[]> {
  const generation = client.getGeneration?.()
  if (client.getState() !== 'connected') {
    throw new Error('Connect this controller before loading workspaces.')
  }
  const reply = await worktreeCatalogRead.request(client, { limit: WORKTREE_PS_FULL_LIMIT })
  if (client.getGeneration?.() !== generation || client.getState() !== 'connected') {
    throw new Error(
      'Controller connection changed. Reload workspaces before assigning an objective.'
    )
  }
  const result = worktreeCatalogRead.interpret(reply)
  if (!result.accepted) {
    throw new Error('Could not read this controller’s workspace catalog.')
  }
  return mobileManagerWorkspaceChoices(result.value)
}
