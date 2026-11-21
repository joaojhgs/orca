import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence/loading-store/store'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'

vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }))
vi.mock('../ipc/filesystem/access/local-file-access-resolution', () => ({
  resolveLocalFileRequestPath: vi.fn(async (filePath: string) => filePath)
}))
vi.mock('../wsl/filesystem/wsl-unc-access-gate', () => ({
  guardWslUncPathAccess: vi.fn((_path: string, access: () => Promise<unknown>) => access())
}))

import { resolveLocalFileRequestPath } from '../ipc/filesystem/access/local-file-access-resolution'
import { guardWslUncPathAccess } from '../wsl/filesystem/wsl-unc-access-gate'
import { readLocalFilePreview } from './media-preview-protocol'
import { readPreviewGrantRange } from './preview-grant-range-read'
import { readSshFilePreview } from './ssh-file-preview'

const emitter = new EventEmitter()
const sender = {
  id: 7101,
  on: vi.fn().mockImplementation((name, callback) => emitter.on(name, callback)),
  removeListener: vi
    .fn()
    .mockImplementation((name, callback) => emitter.removeListener(name, callback))
}
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked authorization resolver never reads Store members.
const store = {} as Store

describe('readPreviewGrantRange', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-preview-range-'))
  })
  afterEach(async () => {
    emitter.emit('destroyed')
    await rm(directory, { recursive: true, force: true })
  })

  async function mint(name: string, bytes: string): Promise<string> {
    const filePath = join(directory, name)
    await writeFile(filePath, bytes)
    const result = await readLocalFilePreview({ sender }, { filePath }, store, { documents: true })
    return result?.mediaUrl ?? ''
  }

  it('never wakes a stopped WSL distro to read a range', async () => {
    const url = await mint('doc.pdf', '%PDF-1.4 body')
    vi.mocked(resolveLocalFileRequestPath).mockClear()
    vi.mocked(guardWslUncPathAccess).mockRejectedValueOnce(new Error('Ubuntu is stopped'))
    await expect(readPreviewGrantRange(sender, url, 0, 4)).rejects.toThrow('Ubuntu is stopped')
    expect(resolveLocalFileRequestPath).not.toHaveBeenCalled()
  })

  it('reads SSH PDF bytes from the minting connection and rejects the grant after reconnect', async () => {
    const connectionId = 'ssh-preview-fixture'
    const filePath = '/remote/doc.pdf'
    const content = Buffer.from('%PDF-1.4 body')
    const unexpectedOperation = async (): Promise<never> => {
      throw new Error('Unexpected filesystem operation outside the remote range fixture')
    }
    const makeProvider = () =>
      ({
        readDir: unexpectedOperation,
        readFile: unexpectedOperation,
        writeFile: unexpectedOperation,
        writeFileBase64: unexpectedOperation,
        writeFileBase64Chunk: unexpectedOperation,
        deletePath: unexpectedOperation,
        createFile: unexpectedOperation,
        createDir: unexpectedOperation,
        createDirNoClobber: unexpectedOperation,
        rename: unexpectedOperation,
        renameNoClobber: unexpectedOperation,
        copy: unexpectedOperation,
        search: unexpectedOperation,
        listFiles: unexpectedOperation,
        watch: unexpectedOperation,
        stat: vi.fn(async () => ({ size: content.length, type: 'file' as const, mtime: 1 })),
        realpath: vi.fn(async () => filePath),
        readFileRange: vi.fn(async (_path: string, offset: number, length: number) => {
          const bytes = content.subarray(offset, offset + length)
          return { bytes, bytesRead: bytes.length }
        })
      }) satisfies IFilesystemProvider
    // Only range operations are exposed by this fixture; any controller filesystem read must fail.
    const original = makeProvider()
    const replacement = makeProvider()
    registerSshFilesystemProvider(connectionId, original)
    vi.mocked(resolveLocalFileRequestPath).mockClear()
    try {
      const preview = await readSshFilePreview(
        { sender },
        { filePath, connectionId, provider: original },
        store,
        { documents: true }
      )
      if (!preview) {
        throw new Error('Missing SSH preview URL')
      }
      expect(
        new TextDecoder().decode(await readPreviewGrantRange(sender, preview.mediaUrl, 1, 3))
      ).toBe('PDF')
      registerSshFilesystemProvider(connectionId, replacement)
      await expect(readPreviewGrantRange(sender, preview.mediaUrl, 1, 3)).rejects.toThrow(
        'SSH connection changed'
      )
      expect(replacement.readFileRange).not.toHaveBeenCalled()
      expect(resolveLocalFileRequestPath).not.toHaveBeenCalled()
    } finally {
      unregisterSshFilesystemProvider(connectionId)
    }
  })

  it('serves bounded PDF reads only to the renderer that minted the live grant', async () => {
    const pdf = await mint('doc.pdf', '%PDF-1.4 body')
    const image = await mint('shot.svg', '<svg/>')
    expect(new TextDecoder().decode(await readPreviewGrantRange(sender, pdf, 1, 3))).toBe('PDF')
    await expect(
      readPreviewGrantRange({ ...sender, id: sender.id + 1 }, pdf, 0, 4)
    ).rejects.toThrow('Preview is no longer available')
    await expect(readPreviewGrantRange(sender, image, 0, 4)).rejects.toThrow()
    await expect(readPreviewGrantRange(sender, pdf, -1, 4)).rejects.toThrow('Invalid preview range')
    await expect(readPreviewGrantRange(sender, pdf, 0, 64 * 1024 * 1024)).rejects.toThrow(
      'Invalid preview range'
    )
    emitter.emit('destroyed')
    await expect(readPreviewGrantRange(sender, pdf, 0, 4)).rejects.toThrow(
      'Preview is no longer available'
    )
  })
})
