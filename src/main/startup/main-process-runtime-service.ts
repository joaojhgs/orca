import {
  applySessionSearchSettingsChange,
  installChildSessionSearchService
} from '../ai-vault-search/session-search-enablement'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { createHeadlessNotificationDelivery } from '../notifications/headless-notification-delivery'
import { confirmAgentNotification } from '../notifications/agent-notification-eligibility'
import { sessionSearchScopeCatalogFromStore } from '../ai-vault-search/session-search-store-scope-catalog'
import { getCanonicalUserDataPath } from '../persistence/loading-store/user-data-path'
import { app } from 'electron'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getLocalPtyProvider, getSshPtyProvider, clearProviderPtyState } from '../ipc/pty'
import { agentHookServer } from '../agent-hooks/server'
import { browserManager } from '../browser/browser-manager'
import { loadAgentSessionClaimSigner } from '../runtime/agent-session-claim-identity'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { prepareCodexAiVaultSessionResume } from '../codex/codex-ai-vault-session-resume'
import { prepareCodexPinnedLaunchHome } from './codex-session-resume-launch'
import { resolveHostCodexSessionSourceHome } from '../codex/codex-session-source-home'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import { getDaemonProvider } from '../daemon/daemon-init'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import type { OrchestrationEnvironmentTransport } from '../runtime/orchestration/environment-transport'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import { resolveTuiAgentLaunchEnv } from '../../shared/tui-agent-launch-defaults'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { fingerprintOrchestrationPeer } from '../runtime/orchestration/environment-transport'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { mainProcessState as state } from './main-process-state'
import {
  codexStructuredLaunchHomeResolvers,
  prepareCodexRuntimeHomeForLaunch
} from './codex-launch-preparation'
import { resolveHostAgentBaseEnvironment } from '../runtime/structured-agent-shell-environment'
import type { RuntimeDesktopWindowStatus } from '../../shared/runtime-types'
import { ArtifactCloudService } from '../artifacts/artifact-cloud-service'
import { LocalArtifactService } from '../artifacts/local-artifact-service'
import { ExecutionAccountUsageService } from '../rate-limits/execution-account-usage-service'
import { getUsageExecutionHosts } from '../execution-observer/usage-execution-hosts'
import { SkillCloudService } from '../skills/skill-cloud-service'
import { isArtifactSharingEnabled } from '../../shared/artifact-sharing-gate'
import {
  AgentStatusObservedPaneIdentities,
  recordObservedAgentStatusPaneIdentity
} from '../runtime/agent-status-observed-pane-identity'
import { startAgentStateRulesLiveUpdates } from '../runtime/agent-state-rules/agent-state-rules-live-update'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { recordManagerHookEvent } from './manager-event-subscription'
import { resolveNotificationPolicyScope } from '../notifications/notification-policy-scope'

export function getDesktopWindowStatus(): RuntimeDesktopWindowStatus {
  const activation = state.desktopActivationGate
  if (!activation) {
    return 'available'
  }
  const value = activation.getState()
  return value === 'ready' ? 'openable' : value
}

export function initializeMainProcessRuntime(): OrcaRuntimeService {
  const store = state.store
  const stats = state.stats
  if (!store || !stats) {
    throw new Error('Store and stats must be initialized before runtime')
  }
  const orchestrationEnvironmentTransport: OrchestrationEnvironmentTransport = {
    resolve: (selector) => {
      const environment = resolveEnvironment(app.getPath('userData'), selector)
      const pairing = getPreferredPairingOffer(environment)
      return {
        environmentId: environment.id,
        name: environment.name,
        peerFingerprint: fingerprintOrchestrationPeer(pairing.publicKeyB64),
        pairingRevision: environment.pairingRevision ?? environment.createdAt
      }
    },
    call: (selector, method, params, timeoutMs, envelope, expectedPairingRevision) =>
      callRuntimeEnvironment(
        app.getPath('userData'),
        selector,
        method,
        params,
        timeoutMs,
        expectedPairingRevision,
        envelope
      )
  }
  // Why here and not in the window listener: `subscribeEnrichedStatus` also fires under headless
  // `orca serve`, which never opens one, and the fleet path runs there too.
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  let headlessNotifications: ReturnType<typeof createHeadlessNotificationDelivery> | null = null
  const runtime = new OrcaRuntimeService(store, stats, {
    prepareClaudeAuth: (target) => state.claudeRuntimeAuth!.prepareForClaudeLaunch(target),
    agentSessionClaimSigner: loadAgentSessionClaimSigner(
      getProfileUserDataPath(),
      getProfileUserDataPath()
    ),
    // Why: resolve the PTY provider lazily — a daemon swap happens later, so an eager reference would freeze the pre-daemon provider (design §4.3).
    getLocalProvider: () => getLocalPtyProvider(),
    // Why: SSH relay providers register after construction and may reconnect, so destructive cleanup must resolve the current generation.
    getSshProvider: (connectionId) => getSshPtyProvider(connectionId),
    onPtyStopped: clearProviderPtyState,
    onTerminalAgentStatus: (event) => agentHookServer.ingestTerminalStatus(event),
    onClaudeTerminalEvidence: (paneKey, evidence) =>
      agentHookServer.observeClaudeTerminalEvidence(paneKey, evidence),
    // Why: serve can be promoted in place, so wire the listener from startup; runtime enables desktop-only scanners only for a ready renderer.
    onTerminalSideEffects: (batch: TerminalSideEffectBatch) => {
      headlessNotifications?.sideEffects(batch)
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('pty:sideEffect', batch)
      }
    },
    getDesktopWindowStatus,
    // Why: worktree.ps pulls hook-reported agent status (same source as the desktop sidebar) at query time so mobile shows the same agents.
    getAgentStatusSnapshot: () =>
      agentHookServer.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true),
    getAgentStatusSnapshotForPane: (paneKey) => agentHookServer.getStatusSnapshotForPane(paneKey),
    // Why: structured chats have no hooks, so the host writes their projections here itself; the
    // snapshot above then lists them for the CLI and mobile without a second store.
    structuredAgentStatusSink: {
      publish: (summary, subject) => agentHookServer.ingestStructuredStatus(summary, subject),
      forget: (subject) => agentHookServer.dropStructuredStatus(subject),
      publishChildWork: (subject, evidence, provider) =>
        agentHookServer.ingestStructuredChildWork(subject, evidence, provider),
      readChildWork: (subject) => agentHookServer.getStructuredChildWorkViews(subject)
    },
    // Why captured rather than resolved at read: the fleet snapshot remints cached rows on every
    // read, so a row observed under one process otherwise acquires whatever the pane owns now.
    readObservedAgentStatusPaneIdentity: (paneKey) => observedPaneIdentities.read(paneKey),
    // Why: the filter above hides resume-identity rows from the live-agent views, but
    // those rows carry the provider session mobile native chat addresses transcripts
    // by — Pi publishes identity that way and would otherwise be unreachable.
    getAgentProviderSessionSnapshot: () => agentHookServer.getStatusSnapshot(),
    getAgentProviderSessionRowsForPane: (paneKey) =>
      agentHookServer.getStatusSnapshotForPane(paneKey),
    attestAgentHookCompatibilityAuthority: (candidate) =>
      agentHookServer.attestCompatibilityAuthority(candidate),
    retireAgentHookCompatibilityAuthority: (paneKey) =>
      agentHookServer.retirePaneAuthority(paneKey),
    checkHookAgentPresence: (paneKey) => agentHookServer.checkAgentPresence(paneKey),
    reconcileAgentStatusForEndedProcess: (paneKeys) =>
      agentHookServer.reconcileEndedProcessForPaneKeys(paneKeys),
    dropAgentStatusForRemovedWorktree: (worktreeId, host) =>
      agentHookServer.dropStatusEntriesForRemovedWorktree(worktreeId, host),
    canRecoverPersistentLocalPtys: () => getDaemonProvider() !== null,
    // Why: evaluated per call, not captured — the RPC server that owns the device registry is
    // constructed with this runtime and does not exist yet at this point.
    getPairedDeviceName: (pairedDeviceId) =>
      state.runtimeRpc?.getDeviceRegistry()?.getDevice(pairedDeviceId)?.name ?? null,
    // Why: source codex-home here (runs in window AND serve) so aiVault.listSessions includes managed-Codex sessions; registerCoreHandlers is window-only.
    getAdditionalAiVaultCodexHomePaths: () =>
      state.codexRuntimeHome?.getHostCodexHomePathsForSessionDiscovery() ?? [],
    prepareAiVaultSessionResume: (args) =>
      prepareCodexAiVaultSessionResume(args, {
        runtimeHome: state.codexRuntimeHome,
        systemCodexHomePath: resolveHostCodexSessionSourceHome(store.getSettings()),
        preparePinnedLaunchHome: (home) => prepareCodexPinnedLaunchHome(home)
      }),
    ...codexStructuredLaunchHomeResolvers,
    prepareCodexCatalogProbeHome: (homePath) =>
      state.codexRuntimeHome?.prepareHostCodexHomeForReadOnlyAppServer(
        homePath,
        resolveTuiAgentLaunchEnv('codex', store.getSettings().agentDefaultEnv)
      ),
    buildAgentHookPtyEnv: () =>
      isAgentStatusHooksEnabled(state.store?.getSettings()) ? agentHookServer.buildPtyEnv() : {},
    orchestrationEnvironmentTransport,
    // Why the same function the settings IPC handler calls: a paired client's write and a
    // local one must reconcile the scanner child through one path, or they can disagree.
    applySessionSearchSettings: applySessionSearchSettingsChange,
    skillTransactionRecovery: state.skillTransactionRecovery
  })
  // Both desktop and headless serve own a host-local search service.
  const sessionSearch = installChildSessionSearchService({
    dataRoot: getCanonicalUserDataPath(),
    getSettings: () => store.getSettings(),
    // Why read per request rather than snapshot: a repo added or a workspace
    // renamed between two searches has to be in scope for the second one.
    // This process answers for its own host, so the catalog is bound to it here.
    getScopeCatalog: () => sessionSearchScopeCatalogFromStore(store, LOCAL_EXECUTION_HOST_ID)
  })
  app.once('will-quit', () => sessionSearch?.dispose())
  // Why here: this runs for the desktop and headless `orca serve`, and each evaluates its own panes.
  startAgentStateRulesLiveUpdates(store, (rules) =>
    recordDurableCrashBreadcrumb('agent_state_rules_active', rules)
  )
  state.runtime = runtime
  runtime.configureNotificationScopePolicy({
    read: () => store.getSettings().notifications.scopePolicy,
    scope: (event) =>
      resolveNotificationPolicyScope(store, event.worktreeId, {
        ...event.notificationScope,
        ...(event.structuredOrigin
          ? {
              executionHostId: event.structuredOrigin.scope.executionHostId,
              sessionId: event.structuredOrigin.sessionId,
              sessionGeneration: String(event.structuredOrigin.journalCursor.epoch)
            }
          : {})
      })
  })
  headlessNotifications = createHeadlessNotificationDelivery({
    enabled: () => state.isServeMode && (!state.mainWindow || state.mainWindow.isDestroyed()),
    settings: () => store.getSettings().notifications,
    dispatch: (event) => runtime.dispatchMobileNotification(event),
    getStatusSnapshot: () => agentHookServer.getEnrichedStatusSnapshot(),
    confirmStopPoint: confirmAgentNotification
  })
  app.once('will-quit', () => headlessNotifications?.dispose())
  agentHookServer.subscribeEnrichedStatus((event) => {
    try {
      recordManagerHookEvent(runtime, store, event)
    } catch {
      console.warn('[manager] Canonical status event could not be journaled; reconcile required')
    }
  })
  agentHookServer.subscribeEnrichedStatus((event) => headlessNotifications?.status(event))
  agentHookServer.subscribeEnrichedStatus((enriched) =>
    recordObservedAgentStatusPaneIdentity(observedPaneIdentities, enriched.paneKey, runtime)
  )
  // Why before anything can attach: a client host that reattaches to a restarted runtime is only
  // handed its pages back if the runtime found them first.
  runtime.rehydrateClientHostedBrowserPages()
  browserManager.setBrowserGuestStateChangedListener((worktreeId) => {
    runtime.notifyMobileSessionTabsChanged(worktreeId)
  })
  return runtime
}

export function configureRuntimeServices(runtime: OrcaRuntimeService): void {
  const store = state.store
  const claudeAccounts = state.claudeAccounts
  const codexAccounts = state.codexAccounts
  const rateLimits = state.rateLimits
  const { claudeUsage, codexUsage, openCodeUsage, museUsage } = state
  if (!claudeUsage || !codexUsage || !openCodeUsage || !museUsage) {
    throw new Error('Usage analytics must be initialized before runtime wiring')
  }
  runtime.setUsageAnalyticsStores({
    claude: claudeUsage,
    codex: codexUsage,
    opencode: openCodeUsage,
    muse: museUsage
  })
  if (!store || !claudeAccounts || !codexAccounts || !rateLimits) {
    throw new Error('Account services must be initialized before runtime wiring')
  }
  const sharingEnabled = () => isArtifactSharingEnabled(state.store?.getSettings())
  const executionUsage = new ExecutionAccountUsageService(
    () => getUsageExecutionHosts(store),
    () => rateLimits.publishExecutionUsageChange()
  )
  rateLimits.setExecutionUsageSource(
    () => executionUsage.getState(),
    () => executionUsage.refresh()
  )
  executionUsage.start()
  app.once('will-quit', () => executionUsage.stop())
  if (process.env.ORCA_ARTIFACTS_BACKEND === 'local') {
    const port = Number(process.env.ORCA_LOCAL_ARTIFACTS_PORT ?? '6769')
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Invalid local artifact port')
    }
    const service = new LocalArtifactService(app.getPath('userData'), sharingEnabled, {
      bindHost: process.env.ORCA_LOCAL_ARTIFACTS_BIND_HOST ?? '127.0.0.1',
      port,
      publicOrigin: process.env.ORCA_LOCAL_ARTIFACTS_PUBLIC_URL
    })
    app.once('will-quit', () => {
      void service.dispose()
    })
    runtime.setArtifactService(service)
    // Why: published links must survive a restart without someone reopening Artifacts first.
    void service.hostingStatus().catch(() => {
      console.error('[local-artifacts] Viewer startup failed')
    })
  } else {
    runtime.setArtifactService(new ArtifactCloudService(app.getPath('userData'), sharingEnabled))
  }
  runtime.setSkillCloudService(new SkillCloudService(app.getPath('userData')))
  runtime.setAccountServices({
    claudeAccounts,
    codexAccounts,
    rateLimits,
    getSettings: () => store.getSettings()
  })
  runtime.setCommitMessageAgentEnvironmentResolvers({
    // Why: Codex hooks/auth live in Orca's managed runtime home even for the default path, so every launch must resolve CODEX_HOME via runtime-home.
    prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
    prepareForClaudeLaunch: (target) => state.claudeRuntimeAuth!.prepareForClaudeLaunch(target),
    resolveBaseEnvironment: () => resolveHostAgentBaseEnvironment(store.getSettings())
  })
}
