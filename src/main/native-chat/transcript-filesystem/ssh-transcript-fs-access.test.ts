import { afterEach, expect, it } from 'vitest'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../../providers/types'
import { readSshTranscript, statSshTranscript } from './ssh-transcript-fs-access'

afterEach(() => unregisterSshFilesystemProvider('desktop'))
it('reads an attested SSH transcript at the requested byte position without local fallback', async () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the transcript adapter uses only stat and readFileRange supplied by this fixture.
  registerSshFilesystemProvider('desktop', {
    stat: async () => ({ size: 7, mtime: 1234, type: 'file' as const }),
    readFileRange: async (path, position, length) => {
      expect(path).toBe('/remote/session.jsonl')
      const bytes = Buffer.from('abcdefg').subarray(position, position + length)
      return { bytes, bytesRead: bytes.length }
    }
  } as unknown as IFilesystemProvider)
  const location = { connectionId: 'desktop', remotePath: '/remote/session.jsonl' }
  expect(await statSshTranscript(location)).toMatchObject({ size: 7, mtimeMs: 1234 })
  const buffer = Buffer.alloc(8, '_')
  expect((await readSshTranscript({ sshTranscript: location }, buffer, 2, 6, 3)).bytesRead).toBe(4)
  expect(buffer.toString()).toBe('__defg__')
  unregisterSshFilesystemProvider('desktop')
  await expect(readSshTranscript({ sshTranscript: location }, buffer, 0, 1, 0)).rejects.toThrow(
    'Remote connection dropped'
  )
})
