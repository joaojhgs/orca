import { describe, expect, it } from 'vitest'
import { parseCodexSessionContent } from './remote-session-legacy-parsers'

const file = {
  path: '/remote/.codex/sessions/rollout.jsonl',
  mtimeMs: 1_700_000_000_000,
  modifiedAt: '2023-11-14T22:13:20.000Z'
}

const records = [
  JSON.stringify({
    type: 'session_meta',
    payload: { id: 'remote-session', cwd: '/remote/project' }
  }),
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Review the parser' }]
    }
  })
]

describe('direct SSH transcript parsing', () => {
  it('folds remote lines with the execution host and remote title lookup', async () => {
    async function* content() {
      yield* records
    }
    const result = await parseCodexSessionContent({
      file,
      content: content(),
      platform: 'linux',
      codexHome: '/remote/.codex',
      executionHostId: 'ssh:parser-fixture',
      executionHostPlatform: 'linux',
      readIndexedTitle: async () => 'Remote review'
    })
    expect(result).toMatchObject({
      agent: 'codex',
      sessionId: 'remote-session',
      executionHostId: 'ssh:parser-fixture',
      cwd: '/remote/project',
      title: 'Remote review'
    })
  })

  it('honors cancellation before parsing a remote transcript', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      parseCodexSessionContent({ file, content: records.join('\n'), signal: controller.signal })
    ).rejects.toThrow('cancelled')
  })
})
