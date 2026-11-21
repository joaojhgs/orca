import {
  parseFileWriteResult,
  type FileWriteDiskPrecondition,
  type FileWriteResult
} from '../../shared/file-write/file-write-disk-precondition'
import type { SshChannelMultiplexer } from '../ssh/protocol/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import { uploadBuffer } from '../ssh/file-transfer/sftp/sftp-upload'
import type { SftpFactory } from './ssh-filesystem-download'
import type { SshRawTransferOptions } from './ssh-filesystem-file-upload'

export async function writeSshFileIfUnchanged(
  mux: SshChannelMultiplexer,
  filePath: string,
  content: string,
  precondition: FileWriteDiskPrecondition
): Promise<FileWriteResult> {
  try {
    const response = await mux.request('fs.writeFileIfUnchanged', {
      filePath,
      content,
      diskPrecondition: precondition
    })
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      typeof response.ok !== 'boolean'
    ) {
      throw new Error('Invalid guarded file write response from SSH relay')
    }
    return parseFileWriteResult(response)
  } catch (error) {
    if (isMethodNotFoundError(error)) {
      throw new Error('The SSH relay needs an update before it can save with a disk precondition')
    }
    throw error
  }
}

export async function writeSshBase64Chunk(
  createSftp: SftpFactory | undefined,
  rawTransfer: SshRawTransferOptions | undefined,
  filePath: string,
  contentBase64: string,
  append: boolean
): Promise<void> {
  const contents = Buffer.from(contentBase64, 'base64')
  if (rawTransfer?.writeBuffer) {
    await rawTransfer.writeBuffer(filePath, contents, { append, exclusive: !append })
    return
  }
  if (!createSftp) {
    throw new Error('remote_binary_upload_unavailable')
  }
  const sftp = await createSftp()
  try {
    // Why: relay fs.writeFile is text-only. SFTP writes the decoded bytes
    // directly so runtime uploads do not corrupt images, PDFs, or archives.
    await uploadBuffer(sftp, contents, filePath, {
      append,
      exclusive: !append
    })
  } finally {
    sftp.end()
  }
}
