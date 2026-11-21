import {
  MAX_SSH_RELAY_GRACE_PERIOD_SECONDS,
  type SshTargetCreateInput,
  type SshTargetUpdateInput
} from '../../../../../../shared/remote-runtime/ssh/ssh-types'
import {
  getSshTargetDraftConnectionFields,
  isRelayGracePeriodValid,
  parseRelayGracePeriodSeconds,
  type EditingTarget
} from '../../../ssh-host-form/ssh-target-draft'
import { translate } from '../../../../i18n/i18n'

type SshTargetSavePayload = {
  target: SshTargetCreateInput
  updates: SshTargetUpdateInput
}

type SshTargetSavePayloadResult =
  | { ok: true; payload: SshTargetSavePayload }
  | { ok: false; error: string }

export function buildSshTargetSavePayload(form: EditingTarget): SshTargetSavePayloadResult {
  const { host, configHost, username, port } = getSshTargetDraftConnectionFields(form)
  if (!host) {
    return {
      ok: false,
      error: translate(
        'auto.components.settings.SshPane.0e5aa04161',
        'Host or SSH config alias is required'
      )
    }
  }

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      error: translate(
        'auto.components.settings.SshPane.4db9afce1c',
        'Port must be between 1 and 65535'
      )
    }
  }

  const graceSeconds = parseRelayGracePeriodSeconds(form)
  if (!isRelayGracePeriodValid(form, graceSeconds)) {
    return {
      ok: false,
      error: translate(
        'auto.components.settings.SshPane.3879cbaa52',
        'Terminal timeout must be between 60 and {{value0}} seconds, or keep terminals alive until reset.',
        { value0: MAX_SSH_RELAY_GRACE_PERIOD_SECONDS }
      )
    }
  }
  const remoteRuntime = form.remoteRuntime === 'auto' ? undefined : form.remoteRuntime
  const identityFile = form.identityFile.trim() || undefined
  const proxyCommand = form.proxyCommand.trim() || undefined
  const jumpHost = form.jumpHost.trim() || undefined
  const systemSshConnectionReuse = form.systemSshConnectionReuse ? undefined : false
  const systemSshProxyConnectionReuse = form.systemSshProxyConnectionReuse ? true : undefined
  const reconnectOnLaunch = form.reconnectOnLaunch ? undefined : false

  const target: SshTargetCreateInput = {
    label: form.label.trim() || (username ? `${username}@${host}` : configHost),
    configHost,
    host,
    port,
    username,
    relayGracePeriodSeconds: graceSeconds,
    ...(remoteRuntime ? { remoteRuntime } : {}),
    ...(form.gssapiAuthentication ? { gssapiAuthentication: true } : {}),
    ...(identityFile ? { identityFile } : {}),
    ...(proxyCommand ? { proxyCommand } : {}),
    ...(jumpHost ? { jumpHost } : {}),
    ...(systemSshConnectionReuse === false ? { systemSshConnectionReuse } : {}),
    ...(systemSshProxyConnectionReuse ? { systemSshProxyConnectionReuse } : {}),
    ...(reconnectOnLaunch === false ? { reconnectOnLaunch } : {}),
    // Send explicit true/false because older servers interpret absence as disabled.
    allowRemoteCliControl: form.allowRemoteCliControl
  }

  return {
    ok: true,
    payload: {
      target,
      updates: {
        ...target,
        // Partial updates need explicit undefined to clear fields inherited from SSH config.
        identityFile,
        gssapiAuthentication: form.gssapiAuthentication || undefined,
        proxyCommand,
        jumpHost,
        systemSshConnectionReuse,
        systemSshProxyConnectionReuse,
        reconnectOnLaunch,
        connectOnStartup: form.reconnectOnLaunch,
        remoteRuntime,
        source: 'manual'
      }
    }
  }
}
