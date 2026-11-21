import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { getAgentModelProbeSpec } from '../../../../shared/agent-session/options/model-catalog/agent-model-probe-spec'
import type { CommitMessagePlan } from '../../../../shared/source-control/ai/generation/commit-message-plan'
import { WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR } from '../../../../shared/shell/launch/windows-batch-spawn'
import { isSshRequestOutcomeUnverifiable } from '../../../ssh/protocol/ssh-channel-multiplexer'
import { userFacingUnsafeWindowsBatchArgs } from '../../../text-generation/failures/source-control-agent-failure'
import { SOURCE_CONTROL_GENERATION_TIMEOUT_MS } from '../../../text-generation/execution/source-control-generation-limits'
import {
  finalizeModelDiscoveryOutput,
  planModelDiscovery,
  staticModelDiscoveryResult
} from '../../../text-generation/models/commit-message-model-discovery-policy'
import type {
  DiscoverCommitMessageModelsResult,
  RemoteCommitMessageExecResult
} from '../../../text-generation/source-control-text-generation-types'

export async function discoverSshCommitMessageModels(input: {
  agentId: TuiAgent
  cwd: string
  execute: (
    plan: CommitMessagePlan,
    cwd: string,
    timeoutMs: number
  ) => Promise<RemoteCommitMessageExecResult>
  agentCommandOverride?: string
}): Promise<DiscoverCommitMessageModelsResult> {
  const spec = getAgentModelProbeSpec(input.agentId)
  if (!spec) {
    return { success: false, error: `Agent "${input.agentId}" does not support model discovery.` }
  }
  if (spec.modelSource === 'static' || !spec.modelDiscovery) {
    return staticModelDiscoveryResult(spec)
  }
  const planned = planModelDiscovery(spec, input.agentCommandOverride)
  if (!planned.ok) {
    return { success: false, error: planned.error }
  }
  let result: RemoteCommitMessageExecResult
  try {
    result = await input.execute(planned.plan, input.cwd, SOURCE_CONTROL_GENERATION_TIMEOUT_MS)
  } catch (error) {
    console.error('[commit-message] Remote model discovery request failed:', error)
    return {
      success: false,
      error: isSshRequestOutcomeUnverifiable(error)
        ? `${spec.label} model discovery took longer than ${SOURCE_CONTROL_GENERATION_TIMEOUT_MS / 1000}s and may still be running on the remote host.`
        : `${spec.label} model discovery could not be reached on the remote PATH. Try again after the SSH connection recovers.`
    }
  }
  if (result.spawnError) {
    if (result.spawnError === WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR) {
      return { success: false, ...userFacingUnsafeWindowsBatchArgs(spec.label) }
    }
    if (/ENOENT/i.test(result.spawnError)) {
      return {
        success: false,
        error: `${planned.plan.binary} not found on the remote PATH. Install ${spec.label} there.`
      }
    }
    console.error('[commit-message] Remote model discovery spawn failed:', result.spawnError)
    return {
      success: false,
      error: `${spec.label} model discovery could not be started on the remote PATH. Check the agent command there and try again.`
    }
  }
  if (result.canceled) {
    return { success: false, error: 'Model discovery canceled.' }
  }
  if (result.timedOut) {
    return {
      success: false,
      error: `${spec.label} model discovery timed out after ${SOURCE_CONTROL_GENERATION_TIMEOUT_MS / 1000}s.`
    }
  }
  return finalizeModelDiscoveryOutput(spec, result.stdout, result.stderr, result.exitCode)
}
