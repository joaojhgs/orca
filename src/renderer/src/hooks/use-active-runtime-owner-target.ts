import { useMemo } from 'react'
import { getSingleFocusedRuntimeEnvironmentId } from '@/lib/single-runtime-legacy-owner'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { resolveFocusedRuntimeOwner } from '@/lib/focused-runtime-owner'
import { getActiveRuntimeTarget, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'

/** Distinguishes "not known yet" from "known to be the local host", without
 *  colliding with an environment id that happens to be named the same. */
const UNRESOLVED = Symbol('runtime-owner-unresolved')

/** Uses the same resolved owner as terminal launches; pending catalogs never guess local. */
export function useActiveRuntimeOwnerTarget(
  mode: 'focused' | 'legacy-single' = 'focused'
): RuntimeClientTarget | null {
  // Why: select the resolved id (a string) rather than its inputs. Selecting
  // `runtimeEnvironments` would churn identity every time a status refresh
  // restores an equal-but-new array, re-firing every consumer's scan.
  const ownerKey = useAppStore((state) => {
    // Why: resolving to "local" before the catalog settles caches a client scan
    // under the local key and flashes "Not installed" at a user whose skills live
    // remotely. Settled rather than hydrated, so a failed catalog read degrades to
    // the local host instead of leaving every badge pending for the session.
    if (!state.runtimeEnvironmentCatalogSettled) {
      return UNRESOLVED
    }
    const environmentId =
      mode === 'legacy-single'
        ? getSingleFocusedRuntimeEnvironmentId(state)
        : resolveFocusedRuntimeOwner(state, isPairedWebClientWindow())
    if (environmentId === undefined) {
      return UNRESOLVED
    }
    return environmentId
      ? formatOwnerKey(environmentId, getPairingRevision(state.runtimeEnvironments, environmentId))
      : null
  })
  return useMemo(
    () =>
      ownerKey === UNRESOLVED
        ? null
        : getActiveRuntimeTarget({ activeRuntimeEnvironmentId: parseOwnerKey(ownerKey) }),
    [ownerKey]
  )
}

// Why: a same-id re-pair is a different peer with its own disk. Folding the
// revision into the key hands consumers a new target, so their discovery
// effects re-run instead of holding the retired peer's scan.
function formatOwnerKey(environmentId: string, pairingRevision: number | undefined): string {
  return `${pairingRevision ?? ''}:${environmentId}`
}

function parseOwnerKey(ownerKey: string | null): string | null {
  return ownerKey === null ? null : ownerKey.slice(ownerKey.indexOf(':') + 1)
}

function getPairingRevision(
  environments: readonly { id: string; createdAt: number; pairingRevision?: number }[],
  environmentId: string
): number | undefined {
  const environment = environments.find((entry) => entry.id === environmentId)
  return environment ? (environment.pairingRevision ?? environment.createdAt) : undefined
}
