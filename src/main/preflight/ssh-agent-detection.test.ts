import { afterEach, expect, it } from 'vitest'
import { setSshAgentDetectionTransportResolver } from '../ssh/targets/ssh-agent-detection-transport'
import { detectInstalledSshAgents, detectSshCommands } from './ssh-agent-detection'

afterEach(() => setSshAgentDetectionTransportResolver(null))

it('uses only the selected relay inventory and excludes disabled or unrequested agents', async () => {
  setSshAgentDetectionTransportResolver((target) => {
    expect(target).toBe('desktop-personal')
    return {
      request: async () => ({ agents: ['codex', 'claude', 'claude', 'invented'] })
    }
  })
  expect(
    await detectInstalledSshAgents('desktop-personal', { disabledTuiAgents: ['codex'] })
  ).toEqual(['claude'])
  expect(await detectSshCommands('desktop-personal', ['codex'])).toEqual(new Set(['codex']))
  setSshAgentDetectionTransportResolver(null)
  await expect(detectInstalledSshAgents('offline')).rejects.toThrow()
})
