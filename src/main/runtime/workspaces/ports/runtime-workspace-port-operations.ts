import type {
  WorkspacePortHostKillRequest,
  WorkspacePortHostScanResult,
  WorkspacePortKillRequest,
  WorkspacePortKillResult,
  WorkspacePortProbe,
  WorkspacePortScanResult
} from '../../../../shared/workspace/ports/workspace-ports'
import {
  filterWorkspacePortProbes,
  killWorkspacePort
} from '../../../ports/workspace-port-ownership'
import { scanExecutionWorkspacePorts } from '../../../ports/execution-workspace-port-scanner'
import {
  killWorkspacePortOnExecutionHost,
  scanWorkspacePortsOnExecutionHost,
  type WorkspacePortExecutionHostDeps
} from '../../../ports/workspace-port-execution-host'
import { getActiveMultiplexer } from '../../../ssh/targets/ssh-target-registry'
import { resolveWorktreeHostRouting } from '../catalog/worktree-launch-host-repo'
import { parseExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { RuntimeWorkspaceSleepOperations } from '../sleep/runtime-workspace-sleep-operations'
export abstract class RuntimeWorkspacePortOperations extends RuntimeWorkspaceSleepOperations {
  async scanWorkspacePorts(repoId?: string, includeSsh = false): Promise<WorkspacePortScanResult> {
    const probes = await this.getAllExecutionWorkspacePortProbes()
    return scanExecutionWorkspacePorts(
      includeSsh ? probes : probes.filter((probe) => !probe.connectionId),
      repoId
    )
  }

  async killWorkspacePort(args: WorkspacePortKillRequest): Promise<WorkspacePortKillResult> {
    return killWorkspacePort(await this.getWorkspacePortProbes(args.repoId), args)
  }

  // Why the workspace, not a client-named host: this server resolves where the workspace runs.
  async scanWorkspacePortsOnHost(worktreeSelector: string): Promise<WorkspacePortHostScanResult> {
    const { executionHostId } = await this.resolveRuntimeFileTarget(worktreeSelector)
    return scanWorkspacePortsOnExecutionHost(executionHostId, this.getWorkspacePortHostDeps())
  }

  async killWorkspacePortOnHost(
    args: WorkspacePortHostKillRequest
  ): Promise<WorkspacePortKillResult> {
    const { executionHostId } = await this.resolveRuntimeFileTarget(args.worktree)
    return killWorkspacePortOnExecutionHost(executionHostId, args, this.getWorkspacePortHostDeps())
  }

  protected getWorkspacePortHostDeps(): WorkspacePortExecutionHostDeps {
    return {
      getLocalProbes: () => this.getWorkspacePortProbes(),
      getSshMultiplexer: getActiveMultiplexer
    }
  }

  // Authorize RPC port probes from host-owned workspace paths, never client-supplied paths.
  protected async getWorkspacePortProbes(repoId?: string): Promise<WorkspacePortProbe[]> {
    return filterWorkspacePortProbes(await this.getAllExecutionWorkspacePortProbes(), repoId)
  }

  protected async getAllExecutionWorkspacePortProbes() {
    const repos = this.requireStore().getRepos()
    return (await this.listResolvedWorktrees()).map((worktree) => {
      const routing = resolveWorktreeHostRouting(repos, worktree)
      const host = routing.kind === 'resolved' ? parseExecutionHostId(routing.hostId) : null
      return {
        id: worktree.id,
        repoId: worktree.repoId,
        displayName: worktree.displayName,
        path: worktree.git.path,
        connectionId: host?.kind === 'ssh' ? host.targetId : undefined,
        runsHere: routing.kind === 'unowned' || host?.kind === 'local'
      }
    })
  }
}
