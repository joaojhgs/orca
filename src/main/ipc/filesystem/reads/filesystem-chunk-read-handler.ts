import { ipcMain } from 'electron'
import { readLocalFileRange } from '../../../filesystem/local-file-io/local-file-range-read'
import { validateFileRangeRequest } from '../../../../shared/file-content/file-range-read'
import { requireSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import { readSshFileRange } from './ssh-file-range'
import { resolveLocalFileRequestPath } from '../access/local-file-access-resolution'
import type { LocalFileAccess } from '../../../../shared/file-access/local-file-access'
import type { FilesystemHandlerContext } from '../filesystem-handler-context'
import { guardWslUncPathAccess } from '../../../wsl/filesystem/wsl-unc-access-gate'

export function registerFilesystemChunkReadHandler({ store }: FilesystemHandlerContext): void {
  ipcMain.handle(
    'fs:readFileChunk',
    async (
      _event,
      args: {
        filePath: string
        connectionId?: string
        access?: LocalFileAccess
        offset: number
        length: number
        wakeWslDistro?: boolean
      }
    ) => {
      validateFileRangeRequest(args.offset, args.length)
      if (args.connectionId != null) {
        const provider = requireSshFilesystemProvider(args.connectionId)
        const { type, size } = await provider.stat(args.filePath)
        if (type === 'directory') {
          throw new Error('Cannot read a directory')
        }
        const bytes = await readSshFileRange(
          provider,
          args.filePath,
          size,
          args.offset,
          args.length
        )
        return {
          contentBase64: bytes.toString('base64'),
          bytesRead: bytes.length,
          eof: args.offset + bytes.length >= size
        }
      }
      return guardWslUncPathAccess(
        args.filePath,
        async () =>
          readLocalFileRange(
            await resolveLocalFileRequestPath(args.filePath, args.access, store),
            args.offset,
            args.length
          ),
        { wake: args.wakeWslDistro === true }
      )
    }
  )
}
