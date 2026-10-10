import { describe, expect, it } from 'vitest'
import { classifyRuntimeLongPoll } from './runtime-rpc-long-poll'

describe('device proxy request admission', () => {
  it.each(['computer.desktopAction', 'emulator.agentScreenshot', 'emulator.attach'])(
    'keeps %s alive and supplies its disconnect abort signal',
    (method) => {
      expect(classifyRuntimeLongPoll({ id: 'device', authToken: 'token', method })).toBe('wait')
    }
  )

  it.each(['computer.desktopTargets', 'emulator.listDevices', 'status.get'])(
    'leaves bounded discovery and status %s outside the long-poll budget',
    (method) => {
      expect(classifyRuntimeLongPoll({ id: 'inventory', authToken: 'token', method })).toBeNull()
    }
  )
})
