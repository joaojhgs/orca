import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import {
  retireSshRelayControlSocket,
  type RelayControlConnection
} from './ssh-relay-control-socket-retirement'

const { removeSocket, getSocket } = vi.hoisted(() => ({
  removeSocket: vi.fn(),
  getSocket: vi.fn()
}))
vi.mock('./ssh-control-socket', () => ({ removeControlSocketPath: removeSocket }))
vi.mock('./system-ssh-args', () => ({ getOrcaControlSocketPath: getSocket }))

const target: SshTarget = {
  id: 'personal',
  label: 'Personal',
  host: 'personal',
  port: 2223,
  username: 'developer'
}
function connection(system = true): RelayControlConnection {
  return {
    usesSystemSshTransport: () => system,
    getTarget: () => target,
    getSystemSshBuildArgsOptions: () => ({ resolvedConfig: null })
  }
}

describe('retireSshRelayControlSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSocket.mockReturnValue('/private/orca-ssh/personal')
  })

  it('retires only the failed target’s Orca-owned reuse endpoint', () => {
    retireSshRelayControlSocket(connection())
    expect(getSocket).toHaveBeenCalledWith(target, { resolvedConfig: null })
    expect(removeSocket).toHaveBeenCalledExactlyOnceWith('/private/orca-ssh/personal')
  })

  it('leaves ssh2 connections untouched', () => {
    retireSshRelayControlSocket(connection(false))
    expect(getSocket).not.toHaveBeenCalled()
    expect(removeSocket).not.toHaveBeenCalled()
  })

  it('does not touch user-owned or disabled ControlMaster endpoints', () => {
    getSocket.mockReturnValue(null)
    retireSshRelayControlSocket(connection())
    expect(removeSocket).not.toHaveBeenCalled()
  })

  it('does nothing after its connection has been detached', () => {
    retireSshRelayControlSocket(null)
    expect(getSocket).not.toHaveBeenCalled()
  })
})
