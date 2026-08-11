import { describe, expect, it, vi } from 'vitest'
import { readRemoteTranscriptTail } from './remote-transcript-reader'

const line = (value: unknown): string => `${JSON.stringify(value)}\n`

describe('readRemoteTranscriptTail', () => {
  it('decodes and windows a Codex transcript through an SSH filesystem provider', async () => {
    const content =
      line({ type: 'event_msg', payload: { type: 'user_message', message: 'first' } }) +
      line({ type: 'event_msg', payload: { type: 'user_message', message: 'second' } })
    const readFile = vi.fn(async () => ({ content, isBinary: false }))

    const result = await readRemoteTranscriptTail({
      provider: { readFile } as never,
      path: '/home/developer/.codex/sessions/rollout.jsonl',
      agent: 'codex',
      limit: 1
    })

    expect(readFile).toHaveBeenCalledWith('/home/developer/.codex/sessions/rollout.jsonl')
    expect(result).toMatchObject({ hasMore: true })
    expect('messages' in result && result.messages).toHaveLength(1)
  })
})
