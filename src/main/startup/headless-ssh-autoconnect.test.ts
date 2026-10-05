import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('../ssh/ssh-target-registry', () => ({ connectRegisteredSshTarget: connect }))
import { reconnectHeadlessSshTargets } from './headless-ssh-autoconnect'

const target: SshTarget = {
  id: 'personal',
  host: 'localhost',
  port: 22,
  username: 'developer',
  label: 'Personal'
}
function store(targets: SshTarget[]) {
  return {
    listTargets: () => targets,
    getTarget: (id: string) => targets.find((item) => item.id === id)
  }
}
describe('headless SSH startup', () => {
  beforeEach(() => {
    connect.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('connects saved targets without a desktop renderer', async () => {
    connect.mockResolvedValue({})
    reconnectHeadlessSshTargets(store([target]))
    await vi.advanceTimersByTimeAsync(0)
    expect(connect).toHaveBeenCalledExactlyOnceWith('personal')
  })
  it('does not override disabled startup or interactive credential targets', () => {
    reconnectHeadlessSshTargets(
      store([
        { ...target, connectOnStartup: false },
        { ...target, id: 'locked', lastRequiredPassphrase: true }
      ])
    )
    expect(connect).not.toHaveBeenCalled()
  })
  it('retries transient failures and stops after a successful connection', async () => {
    connect.mockRejectedValueOnce(new Error('Connection refused')).mockResolvedValue({})
    reconnectHeadlessSshTargets(store([target]))
    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })
  it('does not repeatedly prompt for authentication', async () => {
    connect.mockRejectedValue(new Error('All configured authentication methods failed'))
    reconnectHeadlessSshTargets(store([target]))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).toHaveBeenCalledTimes(1)
  })
  it('stops retrying when a target is removed', async () => {
    const targets = [target]
    connect.mockRejectedValue(new Error('Connection refused'))
    reconnectHeadlessSshTargets(store(targets))
    await vi.advanceTimersByTimeAsync(0)
    targets.length = 0
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
