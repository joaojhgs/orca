import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../orca-runtime'
import { LocalArtifactService } from '../../artifacts/local-artifact-service'
import { isArtifactSharingEnabled } from '../../../shared/artifacts/artifact-sharing-gate'
import { ExecutionAccountUsageService } from '../../rate-limits/execution-account-usage-service'
import { getUsageExecutionHosts } from '../../execution-observer/usage-execution-hosts'
import type { RateLimitService } from '../../rate-limits/service/rate-limit-service'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { resolveNotificationPolicyScope } from '../../notifications/notification-policy-scope'
import { recordManagerHookEvent } from '../manager/manager-event-subscription'
import { startManagerQuestionNotificationRecovery } from '../manager/manager-question-notifications'
import { startManagerDispatchWaitRecovery } from '../manager/manager-dispatch-wait-recovery'

export function configureForkRuntimePolicy(runtime: OrcaRuntimeService, store: Store): () => void {
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
  const unsubscribe = agentHookServer.subscribeEnrichedStatus((event) => {
    try {
      recordManagerHookEvent(runtime, store, event)
    } catch {
      console.warn('[manager] Canonical status event could not be journaled; reconcile required')
    }
  })
  const stopQuestions = startManagerQuestionNotificationRecovery(runtime)
  const stopDispatch = startManagerDispatchWaitRecovery(runtime)
  return () => {
    unsubscribe()
    stopQuestions()
    stopDispatch()
  }
}

export function configureLocalArtifactHosting(
  runtime: OrcaRuntimeService,
  store: Store,
  userDataPath: string
): () => void {
  if (process.env.ORCA_ARTIFACTS_BACKEND !== 'local') {
    return () => {}
  }
  const port = Number(process.env.ORCA_LOCAL_ARTIFACTS_PORT ?? '6769')
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Invalid local artifact port')
  }
  const service = new LocalArtifactService(
    userDataPath,
    () => isArtifactSharingEnabled(store.getSettings()),
    {
      bindHost: process.env.ORCA_LOCAL_ARTIFACTS_BIND_HOST ?? '127.0.0.1',
      port,
      publicOrigin: process.env.ORCA_LOCAL_ARTIFACTS_PUBLIC_URL
    }
  )
  runtime.setArtifactService(service)
  void service.hostingStatus().catch(() => console.error('[local-artifacts] Viewer startup failed'))
  return () => {
    void service.dispose()
  }
}

export function configureExecutionAccountUsage(
  store: Store,
  rateLimits: RateLimitService
): () => void {
  const executionUsage = new ExecutionAccountUsageService(
    () => getUsageExecutionHosts(store),
    () => rateLimits.publishExecutionUsageChange()
  )
  rateLimits.setExecutionUsageSource(
    () => executionUsage.getState(),
    () => executionUsage.refresh()
  )
  executionUsage.start()
  return () => executionUsage.stop()
}
