import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readRelayTranscriptBytes } from './ai-vault-transcript-stream'

describe('relay transcript cancellation', () => {
  it('cancels a read without an unhandled late stream error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orca-transcript-abort-'))
    try {
      const path = join(directory, 'fixture.jsonl')
      await writeFile(path, 'text\n'.repeat(100000))
      const controller = new AbortController()
      const iterator = readRelayTranscriptBytes(path, controller.signal)
      expect((await iterator.next()).done).toBe(false)
      controller.abort()
      await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
