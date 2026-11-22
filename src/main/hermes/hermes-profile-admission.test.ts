import { expect, it } from 'vitest'
import { makeTestBot } from '../bots/bot.test-fixture'
import { resolveHostStructuredAgentCreateSupport } from '../runtime/agent-session/launch/structured-agent-launch-support'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host/execution-host'

const bot = makeTestBot({
  agent: 'hermes',
  folderWorkspaceId: 'personal-home',
  hermesProfile: {
    connectionId: 'worker',
    profile: 'personal',
    home: '/home/developer/.hermes/profiles/personal',
    directory: '/vault'
  }
})
const runtime = {
  requireStore: () => ({
    getBots: () => [bot],
    getSettings: (): never => {
      throw new Error('controller installation was queried')
    }
  }),
  resolveRuntimeFileTarget: async (): Promise<never> => {
    throw new Error('controller folder was probed')
  }
}

it('admits an existing remote Hermes profile without requiring Hermes on the controller', async () => {
  const support = await resolveHostStructuredAgentCreateSupport({
    agent: 'hermes',
    worktreeSelector: 'id:folder:personal-home',
    runtime,
    location: {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      wslDistro: null,
      workspaceId: 'folder:personal-home',
      workspaceKind: 'folder'
    }
  })
  expect(support.supported).toBe(true)
})

it('still checks the controller installation for an ordinary Hermes chat', async () => {
  await expect(
    resolveHostStructuredAgentCreateSupport({
      agent: 'hermes',
      worktreeSelector: 'id:folder:other-home',
      runtime,
      location: {
        executionHostId: LOCAL_EXECUTION_HOST_ID,
        wslDistro: null,
        workspaceId: 'folder:other-home',
        workspaceKind: 'folder'
      }
    })
  ).rejects.toThrow('controller installation was queried')
})
