import type {
  FileWriteDiskPrecondition,
  FileWriteResult
} from '../../shared/file-write/file-write-disk-precondition'
import { readSshDirectoryWithSftpFallback } from './ssh-directory-listing'
import { readSshMarkdownDocuments } from './ssh-markdown-document-listing'
import { readSshPathExistenceBatch } from './ssh-filesystem-path-existence'
import type { PathExistenceResult } from '../../shared/file-access/path-existence-batch'
import type { SshChannelMultiplexer } from '../ssh/protocol/ssh-channel-multiplexer'
import { isMethodNotFoundError, readFileViaStream } from '../ssh/ssh-filesystem-stream-reader'
import { listSshFiles } from './ssh-file-listing'
import { lstatViaSftp } from './ssh-filesystem-provider-sftp'
import {
  downloadFileViaSftp,
  downloadFolderViaSftp,
  type SftpFactory
} from './ssh-filesystem-download'
import { openSshFileUploadSession, type SshRawTransferOptions } from './ssh-filesystem-file-upload'
import {
  closeSshFilesystemWatch,
  registerSshFilesystemWatch,
  stopSshFilesystemWatchRegistration,
  type WatchRegistration
} from './ssh-filesystem-provider-watch'
import type {
  IFilesystemProvider,
  FileRangeReadResult,
  FileReadLimits,
  FileStat,
  FileReadResult,
  FileUploadSession,
  TerminalArtifactAccessOptions
} from './types'
import type { SearchOptions, SearchResult } from '../../shared/file-search/code-search-types'
import type { DirEntry, FsChangeEvent } from '../../shared/filesystem-entry-types'
import { routeSshFilesystemWatchNotification } from './ssh-filesystem-watch-notifications'
import type { WorkspaceSpaceDirectoryScanResult } from '../../shared/workspace-disk-space/workspace-space-types'
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../ssh/remote-host/ssh-remote-platform'
import {
  probeSshQuickOpenSearchCapability,
  probeSshRangedReadCapability
} from './ssh-filesystem-provider-capabilities'
import { readSshFileRange } from './ssh-filesystem-range-read'
import {
  readSshTerminalArtifact,
  writeSshTerminalArtifact
} from './ssh-filesystem-terminal-artifact'
import { readSshDocPreviewFile } from './ssh-filesystem-doc-preview'
import { writeSshBase64Chunk, writeSshFileIfUnchanged } from './ssh-filesystem-provider-writes'

const WORKSPACE_SPACE_SCAN_TIMEOUT_MS = 130_000
export class SshFilesystemProvider implements IFilesystemProvider {
  private connectionId: string
  private mux: SshChannelMultiplexer
  private watchListeners = new Map<string, WatchRegistration>()
  private unsubscribeNotifications: (() => void) | null = null
  private tempDirPromise: Promise<string> | null = null
  private disposed = false
  private loggedStreamFallback = false
  readonly downloadFolder?: IFilesystemProvider['downloadFolder']

  constructor(
    connectionId: string,
    mux: SshChannelMultiplexer,
    private readonly createSftp?: SftpFactory,
    private readonly rawTransfer?: SshRawTransferOptions,
    hostPlatform?: RemoteHostPlatform
  ) {
    this.connectionId = connectionId
    this.mux = mux

    if (createSftp) {
      // Why: system SSH has raw single-file transfer but no ssh2 SFTP channel;
      // omitting this method makes folder capability truthful at the provider boundary.
      // windowsRemotePaths is provider-owned (from host platform), not a caller option.
      const windowsRemotePaths = hostPlatform ? isWindowsRemoteHost(hostPlatform) : undefined
      this.downloadFolder = (sourcePath, destinationPath, options) =>
        downloadFolderViaSftp(createSftp, sourcePath, destinationPath, {
          ...options,
          windowsRemotePaths
        })
    }

    this.unsubscribeNotifications = mux.onNotification((method, params) =>
      routeSshFilesystemWatchNotification(this.watchListeners, method, params)
    )
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    if (this.unsubscribeNotifications) {
      this.unsubscribeNotifications()
      this.unsubscribeNotifications = null
    }
    for (const registration of this.watchListeners.values()) {
      stopSshFilesystemWatchRegistration(this.mux, registration)
    }
    this.watchListeners.clear()
  }

  getConnectionId(): string {
    return this.connectionId
  }

  async readDir(dirPath: string, options?: { followSymlinks?: boolean }): Promise<DirEntry[]> {
    return readSshDirectoryWithSftpFallback(this.mux, dirPath, this.createSftp, options)
  }

  async readFile(filePath: string, limits?: FileReadLimits): Promise<FileReadResult> {
    // Why: streaming is the default path so previews above the legacy single-
    // frame budget (~12 MB after base64) don't hit MAX_MESSAGE_SIZE. Old relays
    // that don't implement fs.readFileStream surface as MethodNotFound; we fall
    // back to the legacy single-shot fs.readFile (which retains the old 10 MB
    // cap on those hosts).
    try {
      return await readFileViaStream(this.mux, filePath, limits)
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        if (!this.loggedStreamFallback) {
          this.loggedStreamFallback = true
          console.warn(
            '[ssh-fs] Relay does not implement fs.readFileStream; falling back to fs.readFile (10 MB cap)'
          )
        }
        return (await this.mux.request('fs.readFile', { filePath })) as FileReadResult
      }
      throw err
    }
  }

  readDocPreviewFile(
    request: Parameters<NonNullable<IFilesystemProvider['readDocPreviewFile']>>[0]
  ): ReturnType<NonNullable<IFilesystemProvider['readDocPreviewFile']>> {
    return readSshDocPreviewFile(this.mux, request)
  }

  readFileRange(
    filePath: string,
    position: number,
    length: number,
    options?: { signal?: AbortSignal }
  ): Promise<FileRangeReadResult> {
    return readSshFileRange(this.mux, filePath, position, length, options?.signal)
  }

  supportsFileRangeRead(options?: { signal?: AbortSignal }): Promise<boolean> {
    return probeSshRangedReadCapability(this.mux, options?.signal)
  }

  readTerminalArtifact(
    filePath: string,
    options: TerminalArtifactAccessOptions
  ): Promise<FileReadResult> {
    return readSshTerminalArtifact(this.mux, filePath, options)
  }

  writeTerminalArtifact(
    filePath: string,
    content: string,
    options: TerminalArtifactAccessOptions
  ): Promise<FileStat> {
    return writeSshTerminalArtifact(this.mux, filePath, content, options)
  }

  async downloadFile(sourcePath: string, destinationPath: string): Promise<void> {
    // Why: system SSH targets cannot open an ssh2-owned SFTP channel.
    if (this.rawTransfer?.downloadFile) {
      await this.rawTransfer.downloadFile(sourcePath, destinationPath)
      return
    }
    await downloadFileViaSftp(this.createSftp, sourcePath, destinationPath)
  }

  async openFileUploadSession(): Promise<FileUploadSession> {
    return openSshFileUploadSession(this.createSftp, this.rawTransfer)
  }

  async getTempDir(): Promise<string> {
    this.tempDirPromise ??= this.mux.request('fs.tempDir', {}).then(
      (result) => result as string,
      (err) => {
        this.tempDirPromise = null
        if (isMethodNotFoundError(err)) {
          return '/tmp'
        }
        throw err
      }
    )
    return this.tempDirPromise
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.mux.request('fs.writeFile', { filePath, content })
  }

  async writeFileBase64(filePath: string, contentBase64: string): Promise<void> {
    await this.writeFileBase64Chunk(filePath, contentBase64, false)
  }

  writeFileIfUnchanged(
    filePath: string,
    content: string,
    precondition: FileWriteDiskPrecondition
  ): Promise<FileWriteResult> {
    return writeSshFileIfUnchanged(this.mux, filePath, content, precondition)
  }

  writeFileBase64Chunk(filePath: string, contentBase64: string, append: boolean): Promise<void> {
    return writeSshBase64Chunk(this.createSftp, this.rawTransfer, filePath, contentBase64, append)
  }

  pathsExist(filePaths: string[]): Promise<PathExistenceResult[]> {
    return readSshPathExistenceBatch(this.mux, filePaths, (path) => this.stat(path))
  }

  async stat(filePath: string): Promise<FileStat> {
    return (await this.mux.request('fs.stat', { filePath })) as FileStat
  }

  async lstat(filePath: string): Promise<FileStat> {
    try {
      return (await this.mux.request('fs.lstat', { filePath })) as FileStat
    } catch (err) {
      if (!isMethodNotFoundError(err)) {
        throw err
      }
      if (!this.createSftp) {
        throw new Error('remote_lstat_unavailable')
      }
      const sftp = await this.createSftp()
      try {
        // Why: older relays predate fs.lstat, but SFTP can still preserve
        // symlink identity for orphaned-worktree safety checks.
        return await lstatViaSftp(sftp, filePath)
      } finally {
        sftp.end()
      }
    }
  }

  async scanWorkspaceSpace(
    rootPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<WorkspaceSpaceDirectoryScanResult> {
    return (await this.mux.request(
      'fs.workspaceSpaceScan',
      { rootPath },
      { signal: options?.signal, timeoutMs: WORKSPACE_SPACE_SCAN_TIMEOUT_MS }
    )) as WorkspaceSpaceDirectoryScanResult
  }

  async deletePath(targetPath: string, recursive?: boolean): Promise<void> {
    await this.mux.request('fs.deletePath', { targetPath, recursive })
  }

  async createFile(filePath: string): Promise<void> {
    await this.mux.request('fs.createFile', { filePath })
  }

  async createDir(dirPath: string): Promise<void> {
    await this.mux.request('fs.createDir', { dirPath })
  }

  async createDirNoClobber(dirPath: string): Promise<void> {
    await this.mux.request('fs.createDirNoClobber', { dirPath })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.mux.request('fs.rename', { oldPath, newPath })
  }

  async renameNoClobber(oldPath: string, newPath: string): Promise<void> {
    try {
      await this.mux.request('fs.renameNoClobber', { oldPath, newPath })
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        // Why: falling back to raw fs.rename can silently clobber the target on
        // older relays. Fail closed and let reconnect deploy the safe relay.
        throw new Error('Remote safe rename is unavailable. Reconnect the SSH target and retry.')
      }
      throw err
    }
  }

  async copy(source: string, destination: string): Promise<void> {
    await this.mux.request('fs.copy', { source, destination })
  }

  async realpath(filePath: string): Promise<string> {
    return (await this.mux.request('fs.realpath', { filePath })) as string
  }

  async search(opts: SearchOptions, options?: { signal?: AbortSignal }): Promise<SearchResult> {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fs.search returns the relay's SearchResult contract; signal stays in local transport options.
    return (await this.mux.request('fs.search', opts, { signal: options?.signal })) as SearchResult
  }

  async listFiles(
    rootPath: string,
    options?: Parameters<IFilesystemProvider['listFiles']>[1]
  ): Promise<string[]> {
    return listSshFiles(this.mux, rootPath, options)
  }

  listMarkdownDocuments = (rootPath: string, options?: { signal?: AbortSignal }) =>
    readSshMarkdownDocuments(this.mux, rootPath, options?.signal, () =>
      this.listFiles(rootPath, { signal: options?.signal })
    )

  supportsQuickOpenSearch = (
    options: { signal?: AbortSignal; minimumVersion?: number } = {}
  ): Promise<boolean> =>
    probeSshQuickOpenSearchCapability(this.mux, options.signal, options.minimumVersion)
  async watch(
    rootPath: string,
    callback: (events: FsChangeEvent[]) => void,
    options?: { signal?: AbortSignal; onTerminalError?: (error: Error) => void }
  ): Promise<() => void> {
    return registerSshFilesystemWatch({
      mux: this.mux,
      disposed: () => this.disposed,
      registrations: this.watchListeners,
      rootPath,
      callback,
      onTerminalError: options?.onTerminalError,
      signal: options?.signal
    })
  }

  async closeWatch(rootPath: string): Promise<void> {
    await closeSshFilesystemWatch(this.mux, this.watchListeners, rootPath)
  }
}
