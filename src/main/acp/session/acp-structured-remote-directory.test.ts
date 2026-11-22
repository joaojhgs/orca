import { afterEach, expect, it } from 'vitest'
import { closeProviderTimelineRigs } from '../../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { openAcpAdapterRig } from './testing/acp-structured-adapter.test-support'

afterEach(closeProviderTimelineRigs)

it('opens a remote ACP session in its provider directory while the SSH process has a local cwd', async () => {
  const rig = await openAcpAdapterRig({ launch: { sessionWorkingDirectory: '/remote/vault' } })
  await rig.acquire()
  expect(rig.child().launch.cwd).toBe('/workspace/project')
  expect(rig.sent('session/new')[0]?.params).toMatchObject({ cwd: '/remote/vault' })
})

it('resumes the same remote conversation without falling back to the controller folder', async () => {
  const rig = await openAcpAdapterRig({
    launch: {
      sessionWorkingDirectory: '/remote/vault',
      resume: {
        sessionId: 'saved',
        key: 'saved-key',
        mayBeUnsaved: async () => false,
        lossKeys: []
      }
    }
  })
  await rig.acquire({ fence: 2 })
  expect(rig.sent('session/load')[0]?.params).toMatchObject({
    sessionId: 'saved',
    cwd: '/remote/vault'
  })
  expect(rig.sent('session/new')).toEqual([])
})
