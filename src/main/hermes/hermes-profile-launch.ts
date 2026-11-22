import type { HermesProfileLink } from '../../shared/bots/hermes-profile'
import { HermesProfileLinkSchema } from '../../shared/bots/hermes-profile'
import type { SshTarget } from '../../shared/remote-runtime/ssh/ssh-types'
import { shellEscapePath } from '../../shared/shell/launch/shell-path-quoting'
import { agentSessionProviderHandleChainHead } from '../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import { agentSessionProviderHandleKey } from '../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import type { AcpLaunchSpec } from '../acp/launch/acp-launch-contract'
import type { AcpStructuredLaunch } from '../acp/launch/acp-structured-launch-resolution'
import type { StructuredAgentLaunchPartResolver } from '../runtime/agent-session/launch/structured-agent-launch-composition'
import { appendSshTargetDestinationArgs } from '../ssh/system-transport/system-ssh-args'
import { findSystemSshAsync } from '../ssh/system-transport/system-ssh-binary-async'
import { listRegisteredSshTargets } from '../ssh/targets/ssh-target-registry'

/** Only an already registered SSH target is dialed; no listener, forwarded agent or copied login. */
export function hermesProfileCommand(link: HermesProfileLink, target: SshTarget): string[] {
  HermesProfileLinkSchema.parse(link)
  if (target.id !== link.connectionId || !link.home.endsWith(`/profiles/${link.profile}`)) {
    throw new Error('hermes_profile_target_mismatch')
  }
  const quote = (value: string) => shellEscapePath(value, 'posix')
  const remote = [
    `test -f ${quote(`${link.home}/config.yaml`)}`,
    `cd ${quote(link.directory)}`,
    // An explicit home never follows Hermes's sticky profile selection. The profile owns
    // its auth fallback, plugins, tool permissions, memory bank and Telegram destination.
    `exec env HERMES_HOME=${quote(link.home)} "$HOME/.local/bin/hermes" acp`
  ].join(' && ')
  const args = [
    '-T',
    '-S',
    'none',
    '-o',
    'BatchMode=yes',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'ConnectTimeout=15'
  ]
  appendSshTargetDestinationArgs(args, target)
  args.push(remote)
  return args
}

/** Orca owns only the chat/SSH client. Hermes keeps the profile's native session and memory. */
export function hermesProfileLaunchPart(
  spec: AcpLaunchSpec,
  link: HermesProfileLink
): StructuredAgentLaunchPartResolver<AcpStructuredLaunch> {
  return async (basis) => {
    if (basis.readOnly) {
      throw new Error('Linked Hermes profiles use their own background scheduling')
    }
    const target = listRegisteredSshTargets().find((entry) => entry.id === link.connectionId)
    if (!target) {
      throw new Error('hermes_profile_ssh_host_not_found')
    }
    const command = await findSystemSshAsync()
    if (!command) {
      throw new Error('OpenSSH is required to connect a Hermes profile')
    }
    const head = agentSessionProviderHandleChainHead(basis.record.providerHandleChain)
    return {
      launch: {
        // The existing remote adapter is validated by its ACP handshake, not a local CLI
        // version probe. Do not send local instructions, plugin paths or MCP endpoints.
        spec,
        command,
        prefixArgs: [],
        args: hermesProfileCommand(link, target),
        sessionWorkingDirectory: link.directory,
        fullAccess: basis.permissionMode === 'full-access',
        resume: head
          ? {
              sessionId: head.handle.nativeId,
              key: agentSessionProviderHandleKey(head.handle),
              mayBeUnsaved: async () => false,
              lossKeys: []
            }
          : null
      },
      env: await basis.baseEnvironment(),
      inheritedEnvToDelete: []
    }
  }
}
