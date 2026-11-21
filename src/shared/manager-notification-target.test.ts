import { describe, expect, it } from 'vitest'
import { managerNotificationId, readManagerNotificationTarget } from './manager-notification-target'

describe('manager notification target', () => {
  const target = { runId: 'run_aabbcc001122', messageId: 'msg_112233aabbcc' }

  it('round trips through the existing ASCII notification ID without host or URL authority', () => {
    const id = managerNotificationId(target)
    expect(id).toBe('manager:v1:run_aabbcc001122:msg_112233aabbcc')
    expect(readManagerNotificationTarget(id)).toEqual(target)
    expect(id.length).toBeLessThan(2048)
    expect(id).toMatch(/^[\x20-\x7e]+$/)
  })

  it.each([
    undefined,
    null,
    {},
    'agent:run_one:msg_one',
    'manager:v2:run_one:msg_one',
    'manager:v1:run_one:msg_one:host_other',
    'manager:v1:run_one:',
    'manager:v1:legacy:msg_one',
    'manager:v1:run_one:other',
    'manager:v1:run_%2Fother:msg_one',
    'manager:v1:run_one:msg_../other',
    'manager:v1:run_💥:msg_one',
    'manager:v1:run_one:msg_one\n',
    `manager:v1:run_${'a'.repeat(129)}:msg_one`
  ])('does not reinterpret malformed or other notification IDs: %j', (value) => {
    expect(readManagerNotificationTarget(value)).toBeNull()
  })

  it('rejects invalid producer targets instead of publishing an unroutable alert', () => {
    expect(() => managerNotificationId({ ...target, runId: 'https://other' })).toThrow()
    expect(() => managerNotificationId({ ...target, messageId: 'msg_other:host' })).toThrow()
  })
})
