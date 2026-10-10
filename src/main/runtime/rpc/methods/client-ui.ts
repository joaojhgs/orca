import { omitPairingLocalUiFields } from '../../../../shared/pairing-local-ui-fields'
import type { PersistedUIState } from '../../../../shared/persisted-ui-state-types'
import { defineMethod } from '../core'
import {
  NativeChatSessionOptionsMutation,
  PRBotAuthorOverrideUpdate,
  SettingsUpdate
} from '../../../../shared/rpc-contract/client-settings-params'
import { FeatureInteractionIdParam, UiUpdate } from './client-ui-schemas'
// Type-only side effect: keeps the schema/PersistedUIState parity assertions in
// the typecheck graph so drift fails the build instead of a paired client.

import { TerminalQuickCommandsUpdate } from '../../../../shared/rpc-contract/terminal-quick-command-params'
import {
  ArtifactPublishingApprovalRequestParams,
  ArtifactPublishingApprovalCheckParams
} from '../../../../shared/rpc-contract/artifact-publishing-approval-params'
import type { RpcContext } from '../core'

function approvalOwner(context: RpcContext): string {
  const owner = context.pairedDeviceId ?? context.clientId
  if (context.clientKind !== 'runtime' || !owner) {
    throw new Error('Publishing approval requests require a paired full-runtime client.')
  }
  return owner
}

export const CLIENT_UI_METHODS = [
  defineMethod({
    name: 'settings.requestArtifactPublishingApproval',
    permission: 'workspace',
    params: ArtifactPublishingApprovalRequestParams,
    handler: (params, context) =>
      context.runtime.requestArtifactPublishingApproval(params.enabled, approvalOwner(context))
  }),
  defineMethod({
    name: 'settings.checkArtifactPublishingApproval',
    permission: 'workspace',
    params: ArtifactPublishingApprovalCheckParams,
    handler: async (params, context) => ({
      status: await context.runtime.checkArtifactPublishingApproval(
        params.requestId,
        approvalOwner(context)
      )
    })
  }),
  defineMethod({
    name: 'settings.get',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => ({ settings: runtime.getClientSettings() })
  }),
  defineMethod({
    name: 'settings.update',
    permission: 'settings-write',
    params: SettingsUpdate,
    handler: async (params, { runtime }) => ({
      settings: await runtime.updateClientSettings(params)
    })
  }),
  defineMethod({
    name: 'settings.getTerminalQuickCommands',
    permission: 'workspace',
    params: null,
    // Why: command bodies can total ~240 KB, so keep unrelated settings reads
    // from carrying them over every paired/relay connection.
    handler: (_params, { runtime }) => ({
      terminalQuickCommands: runtime.getClientTerminalQuickCommands()
    })
  }),
  defineMethod({
    name: 'settings.updateTerminalQuickCommands',
    permission: 'settings-write',
    params: TerminalQuickCommandsUpdate,
    handler: (params, { runtime }) => ({
      terminalQuickCommands: runtime.updateClientTerminalQuickCommands(params.mutation)
    })
  }),
  defineMethod({
    name: 'settings.updatePRBotAuthorOverride',
    permission: 'settings-write',
    params: PRBotAuthorOverrideUpdate,
    handler: (params, { runtime }) => ({
      settings: runtime.updateClientPRBotAuthorOverride(params)
    })
  }),
  defineMethod({
    name: 'settings.mutateNativeChatSessionOptions',
    permission: 'settings-write',
    params: NativeChatSessionOptionsMutation,
    handler: (params, { runtime }) => {
      runtime.updateClientNativeChatSessionOptions(params)
      return { ok: true as const }
    }
  }),
  defineMethod({
    name: 'ui.get',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => ({ ui: omitPairingLocalUiFields(runtime.getUIState()) })
  }),
  defineMethod({
    name: 'ui.set',
    permission: 'workspace',
    params: UiUpdate,
    // Why the fields are dropped here rather than removed from the schema: UiUpdate is strict, so
    // an unlisted key would make the dispatcher reject an old client's ENTIRE payload.
    handler: (params, { runtime }) => ({
      ui: omitPairingLocalUiFields(
        runtime.updateUIState(omitPairingLocalUiFields(params) as Partial<PersistedUIState>)
      )
    })
  }),
  defineMethod({
    name: 'ui.recordFeatureInteraction',
    permission: 'workspace',
    params: FeatureInteractionIdParam,
    handler: (params, { runtime }) => ({
      ui: omitPairingLocalUiFields(runtime.recordFeatureInteraction(params))
    })
  })
]
