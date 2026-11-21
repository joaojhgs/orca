import { analyzeWorkspaceSpace } from '../workspaces/space-analysis/workspace-space-analysis'
import { WorkspaceSpaceScanCancelledError } from '../workspaces/space-analysis/workspace-space-scan-control'
import type { WorkspaceSpaceAnalyzeResult } from '../../shared/workspace-disk-space/workspace-space-types'
import type { Store } from '../persistence/loading-store/store'
import { RuntimeWorkspaceCleanup } from './runtime-workspace-cleanup'
import { OrcaRuntimeWithAgentTransitions } from './construction/orca-runtime-agent-transitions'
import { OrcaRuntimeWithSidebarTemporal } from './sidebar-inputs/orca-runtime-sidebar-temporal'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../shared/sidebar-list/feed/sidebar-inputs-switch'

const OrcaRuntimeSidebarBase: typeof OrcaRuntimeWithAgentTransitions = ORCA_SIDEBAR_INPUTS_IS_MAIN
  ? OrcaRuntimeWithSidebarTemporal
  : OrcaRuntimeWithAgentTransitions
export abstract class OrcaRuntimeWithWorkspaceResources extends OrcaRuntimeSidebarBase {
  private workspaceCleanupService: RuntimeWorkspaceCleanup | null = null

  getWorkspaceCleanupService(): RuntimeWorkspaceCleanup {
    const profileStore = this.store
    if (!profileStore) {
      throw new Error('runtime_unavailable')
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Production runtime hosts supply the profile Store, narrowed by RuntimeStore.
    return (this.workspaceCleanupService ??= new RuntimeWorkspaceCleanup(profileStore as Store))
  }
  private workspaceSpaceAbortController: AbortController | null = null
  private workspaceSpaceAnalysisPromise: Promise<WorkspaceSpaceAnalyzeResult> | null = null

  analyzeWorkspaceSpace(): Promise<WorkspaceSpaceAnalyzeResult> {
    const profileStore = this.store
    if (!profileStore) {
      throw new Error('runtime_unavailable')
    }
    if (this.workspaceSpaceAnalysisPromise) {
      return this.workspaceSpaceAnalysisPromise
    }
    const controller = new AbortController()
    this.workspaceSpaceAbortController = controller
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Both production hosts supply their profile Store; RuntimeStore only narrows its declared surface.
    const store = profileStore as Store
    const scan = analyzeWorkspaceSpace(store, { signal: controller.signal })
      .then((analysis): WorkspaceSpaceAnalyzeResult => ({ ok: true, analysis }))
      .catch((error: unknown): WorkspaceSpaceAnalyzeResult => {
        if (error instanceof WorkspaceSpaceScanCancelledError) {
          return { ok: false, cancelled: true }
        }
        throw error
      })
      .finally(() => {
        if (this.workspaceSpaceAbortController === controller) {
          this.workspaceSpaceAbortController = null
          this.workspaceSpaceAnalysisPromise = null
        }
      })
    this.workspaceSpaceAnalysisPromise = scan
    return scan
  }

  cancelWorkspaceSpaceAnalysis(): boolean {
    const controller = this.workspaceSpaceAbortController
    if (!controller || controller.signal.aborted) {
      return false
    }
    controller.abort()
    return true
  }
}
