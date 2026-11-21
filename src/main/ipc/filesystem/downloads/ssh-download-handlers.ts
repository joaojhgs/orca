import { BrowserWindow, dialog, ipcMain } from 'electron'
import { lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getRuntimePathBasename } from '../../../../shared/file-access/cross-platform-path'
import { isENOENT } from '../../../filesystem/local-file-io/filesystem-path-containment'
import { requireSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import { abortWhenRendererGone } from '../../renderer-requests/renderer-lifetime-abort'
import { sanitizeLocalDownloadFilename } from './local-download-filename'
import {
  promoteLocalDownloadedFolder,
  publishLocalDownloadedFileNoClobber
} from './local-downloaded-folder-promotion'
import {
  cleanupLocalTransferPath,
  createSiblingTransferPath,
  inspectDownloadDestination,
  promoteDownloadedFile,
  type DownloadFileResult
} from './filesystem-download-promotion'

function requireDownloadArgument(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

async function assertFolderDestinationAvailable(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isENOENT(error)) {
      return
    }
    throw error
  }
  throw new Error('Destination folder already exists')
}

export function registerSshDownloadHandlers(): void {
  ipcMain.handle(
    'fs:downloadFile',
    async (
      event,
      args: { filePath?: string; connectionId?: string }
    ): Promise<DownloadFileResult> => {
      const filePath = requireDownloadArgument(args?.filePath, 'filePath')
      const connectionId = requireDownloadArgument(args?.connectionId, 'connectionId')
      const provider = requireSshFilesystemProvider(connectionId)
      if (!provider.downloadFile) {
        throw new Error('Remote file download is unavailable. Reconnect the SSH target and retry.')
      }
      if (event.sender.isDestroyed()) {
        return { canceled: true }
      }
      const lifetime = abortWhenRendererGone(event.sender)
      let tempPath: string | null = null
      try {
        const remoteStat = await provider.stat(filePath)
        if (remoteStat.type === 'directory') {
          throw new Error('Cannot download a directory')
        }
        lifetime.signal.throwIfAborted()
        const defaultPath = sanitizeLocalDownloadFilename(getRuntimePathBasename(filePath))
        const parentWindow = BrowserWindow.fromWebContents(event.sender)
        const result = parentWindow
          ? await dialog.showSaveDialog(parentWindow, { defaultPath })
          : await dialog.showSaveDialog({ defaultPath })
        if (lifetime.signal.aborted || result.canceled || !result.filePath) {
          return { canceled: true }
        }
        const destinationPath = result.filePath
        const { existed } = await inspectDownloadDestination(destinationPath)
        lifetime.signal.throwIfAborted()
        tempPath = createSiblingTransferPath(destinationPath, 'download')
        await provider.downloadFile(filePath, tempPath)
        lifetime.signal.throwIfAborted()
        await (existed
          ? promoteDownloadedFile(tempPath, destinationPath, true)
          : publishLocalDownloadedFileNoClobber(tempPath, destinationPath, lifetime.signal))
        tempPath = null
        return { canceled: false, destinationPath }
      } finally {
        lifetime.dispose()
        await cleanupLocalTransferPath(tempPath)
      }
    }
  )

  ipcMain.handle(
    'fs:downloadFolder',
    async (
      event,
      args: { dirPath?: string; connectionId?: string }
    ): Promise<DownloadFileResult> => {
      const dirPath = requireDownloadArgument(args?.dirPath, 'dirPath')
      const connectionId = requireDownloadArgument(args?.connectionId, 'connectionId')
      const provider = requireSshFilesystemProvider(connectionId)
      if (!provider.downloadFolder) {
        throw new Error(
          'Remote folder download is unavailable. Reconnect the SSH target and retry.'
        )
      }
      if (event.sender.isDestroyed()) {
        return { canceled: true }
      }
      const lifetime = abortWhenRendererGone(event.sender)
      let tempPath: string | null = null
      try {
        const basename = sanitizeLocalDownloadFilename(getRuntimePathBasename(dirPath))
        const parentWindow = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory']
        }
        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, options)
          : await dialog.showOpenDialog(options)
        const parentPath = result.filePaths?.[0]
        if (lifetime.signal.aborted || result.canceled || !parentPath) {
          return { canceled: true }
        }
        const destinationPath = join(parentPath, basename)
        await assertFolderDestinationAvailable(destinationPath)
        lifetime.signal.throwIfAborted()
        tempPath = createSiblingTransferPath(destinationPath, 'download')
        await provider.downloadFolder(dirPath, tempPath, { signal: lifetime.signal })
        lifetime.signal.throwIfAborted()
        await promoteLocalDownloadedFolder(tempPath, destinationPath, lifetime.signal)
        return { canceled: false, destinationPath }
      } finally {
        lifetime.dispose()
        if (tempPath) {
          await rm(tempPath, { recursive: true, force: true }).catch((error: unknown) => {
            console.warn('[filesystem] Failed to remove the temporary folder download', error)
          })
        }
      }
    }
  )
}
