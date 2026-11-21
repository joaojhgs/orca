import '../../../../shared/git/admission/git-admission-state'
import '../../../crash-reporting/process-exits/main-process-lifecycle-identity'
import { join } from 'node:path'
import { getSshPtyProvider } from '../../../ipc/pty/provider/registry'
import type { IPtyProvider } from '../../../providers/types'
import { installSkillOnSshHost } from '../../../skills/ssh-relay/skill-ssh-relay-service'
import { installSkillBundleOnSshHost } from '../../../skills/ssh-relay/skill-bundle-ssh-relay-service'
import { detectInstalledAgentsWithShellPathHydration } from '../../../preflight/installed-agent-detection'
import { executeSkillInstallRequest } from '../../../skills/install/skill-install-request'
import { executeSkillBundleInstallRequest } from '../../../skills/install/skill-bundle-install-request'
import { SkillUploadSessionService } from '../../../skills/runtime-upload/skill-upload-session-service'
import { SKILL_UPLOAD_STAGING_ROOT_NAME } from '../../../skills/runtime-upload/skill-upload-staging-ownership'
import {
  disposeRuntimeSkillLibrary,
  getRuntimeSkillLibrary,
  skillLibraryWorkspaces
} from '../../runtime-skill-library'
import type {
  SkillBundleInstallProgress,
  SkillBundleInstallRequest,
  SkillBundleInstallResult
} from '../../../../shared/skills/installation/skill-bundle-install-contract'
import type {
  SkillInstallRequest,
  SkillInstallResult
} from '../../../../shared/skills/installation/skill-install-contract'
import type { RuntimeSkillCommandHost } from './runtime-skill-command-contract'
import type {
  BundledSkillAutoUpdateRequest,
  LocalBundledSkillExecuteRequest,
  BundledSkillInstallResult,
  BundledSkillPlan,
  LocalBundledSkillPlanRequest
} from '../../../../shared/skills/bundled/bundled-skill-plan'
import {
  autoUpdateLocalBundledSkills,
  executeLocalBundledSkills,
  planLocalBundledSkills
} from './runtime-bundled-skill-install'
import {
  createSkillInstallAuthority,
  folderExecutionHostId,
  resolveSkillSshDestination,
  resolveSkillProviderRoots
} from './runtime-skill-install-authority'

function normalizeSshRelaySkillDestination(
  destination: SkillInstallRequest['destination']
): SkillInstallRequest['destination'] {
  return destination.scope === 'global'
    ? { scope: 'global', executionTarget: { kind: 'host' } }
    : destination
}

export const SKILL_SSH_UNAVAILABLE = 'skill-install-ssh-relay-unavailable'

export class RuntimeSkillInstallCommands {
  private skillUploadSessions: SkillUploadSessionService | null = null
  private skillShutdown: Promise<void> | null = null
  protected readonly operations = new Map<string, AbortController>()
  protected readonly progress = new Map<string, SkillBundleInstallProgress>()

  constructor(protected readonly host: RuntimeSkillCommandHost) {
    void Promise.resolve()
      .then(() => {
        if (!this.skillShutdown) {
          getRuntimeSkillLibrary(this.host)
        }
      })
      .catch(() => console.warn('[skills] Local skill library startup failed'))
  }

  getLocalSkillLibrary() {
    if (this.skillShutdown) {
      throw new Error('skill-library-service-disposed')
    }
    return getRuntimeSkillLibrary(this.host)
  }
  listSkillLibraryWorkspaces() {
    return skillLibraryWorkspaces(this.host)
  }

  protected userDataPath(): string {
    return this.host.getUserDataPath()
  }
  protected requireUploads(): SkillUploadSessionService {
    if (this.skillShutdown) {
      throw new Error('skill-upload-service-disposed')
    }
    this.skillUploadSessions ??= new SkillUploadSessionService(
      join(this.userDataPath(), 'skill-installs', SKILL_UPLOAD_STAGING_ROOT_NAME)
    )
    return this.skillUploadSessions
  }
  disposeSkillUploadSessions(): Promise<void> {
    if (!this.skillShutdown) {
      const sessions = this.skillUploadSessions
      this.skillUploadSessions = null
      this.skillShutdown = Promise.all([
        disposeRuntimeSkillLibrary(this.host),
        sessions?.dispose()
      ]).then(() => {})
    }
    return this.skillShutdown
  }
  // Why: this process serves no SSH target; a managed host installs skills as a paired runtime.
  protected async refuseSshDestination(
    destination: SkillInstallRequest['destination']
  ): Promise<void> {
    if (await resolveSkillSshDestination(this.host, destination)) {
      throw new Error(SKILL_SSH_UNAVAILABLE)
    }
  }
  protected requireSsh(connectionId: string): IPtyProvider {
    const provider = getSshPtyProvider(connectionId)
    if (!provider?.requestHostRpc) {
      throw new Error('skill-install-ssh-relay-unavailable')
    }
    return provider
  }
  protected sshTarget(destination: SkillInstallRequest['destination']) {
    return resolveSkillSshDestination(this.host, destination).then((target) =>
      target
        ? { provider: () => this.requireSsh(target.connectionId), workspace: target.workspace }
        : null
    )
  }
  protected roots(destination: Parameters<typeof resolveSkillProviderRoots>[1]) {
    return resolveSkillProviderRoots(this.host, destination)
  }
  protected authority() {
    return createSkillInstallAuthority(this.host)
  }
  protected folderExecutionHostId(folder: Parameters<typeof folderExecutionHostId>[0]) {
    return folderExecutionHostId(folder)
  }
  private async executeInstall(
    request: SkillInstallRequest,
    signal: AbortSignal
  ): Promise<SkillInstallResult> {
    const target = await this.sshTarget(request.destination)
    if (target) {
      return installSkillOnSshHost({
        provider: target.provider,
        userDataPath: this.userDataPath(),
        request: {
          ...request,
          destination: normalizeSshRelaySkillDestination(request.destination)
        },
        workspace: target.workspace,
        requireHttps: this.host.isPackaged(),
        signal
      })
    }
    await this.host.skillTransactionRecovery
    const origins = ['https://storage.googleapis.com']
    if (!this.host.isPackaged() && process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS) {
      origins.push(
        ...process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    }
    return executeSkillInstallRequest(request, {
      authority: this.authority(),
      stateDirectory: this.userDataPath(),
      allowedDownloadOrigins: [...new Set(origins)],
      requireHttps: this.host.isPackaged(),
      resolveStagedUpload: (uploadId, identity) => this.requireUploads().take(uploadId, identity),
      detectProviders: detectInstalledAgentsWithShellPathHydration,
      resolveProviderRootOverrides: (destination) => this.roots(destination),
      signal
    })
  }
  async installSharedSkillRequest(
    request: SkillInstallRequest,
    signal?: AbortSignal
  ): Promise<SkillInstallResult> {
    if (this.operations.has(request.operationId)) {
      throw new Error('skill-install-operation-in-progress')
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) {
      abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
    this.operations.set(request.operationId, controller)
    try {
      return await this.executeInstall(request, controller.signal)
    } finally {
      signal?.removeEventListener('abort', abort)
      if (this.operations.get(request.operationId) === controller) {
        this.operations.delete(request.operationId)
      }
    }
  }
  async installSharedSkillBundleRequest(
    request: SkillBundleInstallRequest,
    signal?: AbortSignal,
    onProgress?: (progress: SkillBundleInstallProgress) => void
  ): Promise<SkillBundleInstallResult> {
    if (this.operations.has(request.operationId)) {
      throw new Error('skill-install-operation-in-progress')
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) {
      abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
    this.operations.set(request.operationId, controller)
    const report = (value: SkillBundleInstallProgress) => {
      this.progress.set(request.operationId, value)
      try {
        onProgress?.(value)
      } catch {}
    }
    try {
      const target = await this.sshTarget(request.destination)
      if (target) {
        return await installSkillBundleOnSshHost({
          provider: target.provider,
          userDataPath: this.userDataPath(),
          request: {
            ...request,
            destination: normalizeSshRelaySkillDestination(request.destination)
          },
          workspace: target.workspace,
          requireHttps: this.host.isPackaged(),
          signal: controller.signal,
          onProgress: report
        })
      }
      await this.host.skillTransactionRecovery
      const origins = ['https://storage.googleapis.com']
      if (!this.host.isPackaged() && process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS) {
        origins.push(
          ...process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS.split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      }
      return await executeSkillBundleInstallRequest(request, {
        authority: this.authority(),
        stateDirectory: this.userDataPath(),
        allowedDownloadOrigins: [...new Set(origins)],
        requireHttps: this.host.isPackaged(),
        resolveStagedUpload: (uploadId, identity) => this.requireUploads().take(uploadId, identity),
        detectProviders: detectInstalledAgentsWithShellPathHydration,
        resolveProviderRootOverrides: (destination) => this.roots(destination),
        signal: controller.signal,
        onProgress: report
      })
    } finally {
      signal?.removeEventListener('abort', abort)
      if (this.operations.get(request.operationId) === controller) {
        this.operations.delete(request.operationId)
      }
      this.progress.delete(request.operationId)
    }
  }
  planLocalBundledSkills(request: LocalBundledSkillPlanRequest): Promise<BundledSkillPlan> {
    return planLocalBundledSkills(this.host, request)
  }
  executeLocalBundledSkills(
    request: LocalBundledSkillExecuteRequest
  ): Promise<BundledSkillInstallResult> {
    return executeLocalBundledSkills(this.host, request)
  }
  autoUpdateLocalBundledSkills(
    request: BundledSkillAutoUpdateRequest
  ): Promise<BundledSkillInstallResult> {
    return autoUpdateLocalBundledSkills(this.host, request)
  }
  getSharedSkillInstallProgress(operationId: string) {
    return this.progress.get(operationId) ?? null
  }
  cancelSharedSkillInstall(operationId: string): boolean {
    const operation = this.operations.get(operationId)
    operation?.abort()
    return Boolean(operation)
  }
}
