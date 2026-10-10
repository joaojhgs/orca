import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationSessionCaller } from '../../../../orchestration/orchestration-caller-identity'
import { resolveDispatchCallerWorktreeId } from '../../orchestration-caller-workspace'
import { resolveWorkerConfiguredAgentParams } from './worker-configured-agent-preflight'
import { probeWorkerOpenCodeModelLaunchSupport } from './worker-opencode-model-preflight'
import { assertOrchestrationWorktreeCreationSupported } from './folder-worktree-placement'
import { prepareLocalWorkerStart } from './worker-start-validation'
import type { WorkerStartInput } from './worker-start-schema'
import type { WorkerStartServiceOrigin } from './worker-start-origin'

export async function resolveLocalWorkerStartTarget(args: {
  runtime: OrcaRuntimeService
  params: WorkerStartInput
  callerSession?: OrchestrationSessionCaller
  serviceOrigin?: WorkerStartServiceOrigin
}) {
  const { runtime, params, callerSession, serviceOrigin } = args
  const requestedWorktree = params.worktree ?? 'current'
  const createsWorktree = requestedWorktree === 'new-child' || requestedWorktree === 'new-top-level'
  const callerWorkspaceId =
    serviceOrigin?.workspaceId ??
    (await resolveDispatchCallerWorktreeId(runtime, params.from, callerSession))
  const parent = createsWorktree
    ? await runtime.showManagedWorktree(`id:${callerWorkspaceId}`)
    : undefined
  const target = createsWorktree
    ? { repo: params.repo ?? parent?.repoId }
    : { worktree: requestedWorktree === 'current' ? `id:${callerWorkspaceId}` : requestedWorktree }
  const launchParams = await resolveWorkerConfiguredAgentParams(runtime, params, async () => target)
  const openCodeModelLaunchSupported =
    !createsWorktree && launchParams.agent === 'opencode' && launchParams.model
      ? await probeWorkerOpenCodeModelLaunchSupport(runtime, launchParams, target)
      : false
  const { agent, launch } = prepareLocalWorkerStart({
    params: launchParams,
    createsWorktree,
    runtime,
    openCodeModelLaunchSupported
  })
  if (parent) {
    await assertOrchestrationWorktreeCreationSupported({
      runtime,
      repoSelector: params.repo ?? parent.repoId,
      existingPlacement: 'current or an exact existing folder workspace'
    })
  }
  const resolvedWorktree = parent
    ? undefined
    : requestedWorktree === 'current'
      ? await runtime.showManagedTerminalWorkspace(`id:${callerWorkspaceId}`)
      : await runtime.showManagedTerminalWorkspace(requestedWorktree)
  return {
    requestedWorktree,
    createsWorktree,
    creationWorktree: parent,
    resolvedWorktree,
    agent,
    launch
  }
}
