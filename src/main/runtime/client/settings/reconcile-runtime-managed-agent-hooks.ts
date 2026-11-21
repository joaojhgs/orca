import { getAppEnvironment } from '../../../../shared/app-lifecycle/app-environment'
import { recordManagedHookInstallFailure } from '../../../agent-hooks/installation/install-telemetry'
import { applyAgentStatusHooksEnabled } from '../../../agent-hooks/installation/managed-agent-hook-controls'
import { isWslHostOrcadProcessAsync } from '../../../wsl/filesystem/wsl-guest-windows-drive-path'
import { isAgentStatusHooksEnabledForAgent } from '../../../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'

export async function reconcileRuntimeManagedAgentHooks(
  readSettings: () => NonNullable<Parameters<typeof applyAgentStatusHooksEnabled>[1]> | undefined
): Promise<void> {
  const keepSharedEntries = await isWslHostOrcadProcessAsync()
  const settings = readSettings()
  if (!settings) {
    return
  }
  await applyAgentStatusHooksEnabled(settings.agentStatusHooksEnabled !== false, settings, {
    // R42, COMPAT(wsl-bridge): the bridge's panes in this distro share these entries; drop at D4.
    keepSharedEntries,
    shouldHydrateShellPath: getAppEnvironment().isPackaged(),
    onInstallError: recordManagedHookInstallFailure,
    shouldContinue: (agent) => {
      const current = readSettings()
      return current !== undefined && isAgentStatusHooksEnabledForAgent(current, agent)
    }
  })
}
