import type { SingleRuntimeLegacyOwnerState } from './single-runtime-legacy-owner'

/** Undefined means ambiguous or missing: never fall back to local for a retired peer. */
export function resolveFocusedRuntimeOwner(
  state: SingleRuntimeLegacyOwnerState,
  pairedWebClient: boolean
): string | null | undefined {
  const environments = state.runtimeEnvironments ?? []
  if (pairedWebClient) {
    return environments.length === 1 ? environments[0].id.trim() || undefined : undefined
  }
  const focused = state.settings?.activeRuntimeEnvironmentId?.trim()
  if (!focused) {
    return null
  }
  return environments.some((entry) => entry.id === focused) ? focused : undefined
}
