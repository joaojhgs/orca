import { describe, expect, it } from 'vitest'
import { ORCA_SSH_BRIDGE_CREDENTIAL_ENV } from '../../shared/ssh-bridge-credential-env'
import {
  refuseOwnerOnlySshBridgeCommand,
  refuseSshBridgeEnvironmentRouting
} from './ssh-bridge-command-policy'

const BRIDGED = { [ORCA_SSH_BRIDGE_CREDENTIAL_ENV]: 'sshb_test' }

describe('owner-only commands over the SSH bridge', () => {
  it.each([
    [['account', 'add']],
    [['account', 'list']],
    [['account', 'select']],
    [['account', 'rm']],
    [['environment', 'add']],
    [['skills', 'install']],
    [['agent', 'hooks', 'on']],
    [['profile', 'state', 'rollback']],
    [['plugin', 'check']],
    [['plugin', 'test']],
    [['manager', 'authorize']],
    [['serve']],
    [['claude-teams']]
  ])('refuses %j, which acts on the Orca host directly', (commandPath) => {
    expect(() => refuseOwnerOnlySshBridgeCommand(commandPath, new Map(), BRIDGED)).toThrow(
      /cannot run from an SSH host/
    )
  })

  it.each([['environment'], ['pairing-code']])(
    'refuses --%s, which routes through the host’s paired servers',
    (flag) => {
      expect(() =>
        refuseOwnerOnlySshBridgeCommand(['terminal', 'list'], new Map([[flag, 'prod']]), BRIDGED)
      ).toThrow(/paired servers/)
    }
  )

  it('refuses --host runtime:<id> routing', () => {
    expect(() => refuseSshBridgeEnvironmentRouting('env-1', BRIDGED)).toThrow(/paired servers/)
  })

  it('keeps the CDP loopback listener on the caller while allowing scoped ticket RPCs', () => {
    expect(() =>
      refuseOwnerOnlySshBridgeCommand(['computer', 'browser-connect'], new Map(), BRIDGED)
    ).toThrow(expect.objectContaining({ code: 'forbidden' }))
    expect(() =>
      refuseOwnerOnlySshBridgeCommand(['computer', 'browser-connect'], new Map(), {})
    ).not.toThrow()
    expect(() =>
      refuseOwnerOnlySshBridgeCommand(['computer', 'browser-ticket'], new Map(), BRIDGED)
    ).not.toThrow()
  })

  it('leaves runtime-routed commands to the scoped runtime socket', () => {
    expect(() =>
      refuseOwnerOnlySshBridgeCommand(['account', 'usage'], new Map(), BRIDGED)
    ).not.toThrow()
    expect(() =>
      refuseOwnerOnlySshBridgeCommand(['terminal', 'list'], new Map(), BRIDGED)
    ).not.toThrow()
    expect(() =>
      refuseOwnerOnlySshBridgeCommand(['skills', 'list'], new Map(), BRIDGED)
    ).not.toThrow()
  })

  it.each(['environment', 'pairing-code'])(
    'usage cannot use --%s to bypass the SSH routing boundary',
    (flag) => {
      expect(() =>
        refuseOwnerOnlySshBridgeCommand(['account', 'usage'], new Map([[flag, 'other']]), BRIDGED)
      ).toThrow(/paired servers/)
    }
  )

  it('does nothing outside the bridge', () => {
    expect(() => refuseOwnerOnlySshBridgeCommand(['account', 'add'], new Map(), {})).not.toThrow()
    expect(() => refuseSshBridgeEnvironmentRouting('env-1', {})).not.toThrow()
  })
})
