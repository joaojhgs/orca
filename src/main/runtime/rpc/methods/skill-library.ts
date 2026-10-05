import { defineMethod } from '../core'
import { SkillLibraryLinkParams } from '../../../../shared/skill-library-link-contract'
import {
  discoverLinkedSkills,
  resolveLinkSkillSource
} from '../../../skills/skill-library-link-source'
import {
  skillLibraryHosts,
  skillLibraryProviders,
  skillLibrarySource
} from '../../runtime-skill-library'
import {
  SkillLibraryAssignParams,
  SkillLibraryAssignmentParams,
  SkillLibraryDiscoverParams,
  SkillLibraryImportParams,
  SkillLibraryPreviewParams,
  SkillLibraryReconcileParams,
  SkillLibraryVersionParams,
  SkillLibraryVersionPreviewParams
} from '../../../../shared/skill-library-contract'
import {
  LocalSkillPublishParams,
  LocalSkillRevokeParams
} from '../../../../shared/local-skill-sharing'
import {
  publishLibrarySkills,
  revokeLibraryShare,
  localSkillShareUrl
} from '../../../skills/local-skill-library-sharing'
import { previewLibraryVersion } from '../../../skills/skill-library-snapshot-preview'
import { basename } from 'node:path'
import { ArtifactSharingDisabledError } from '../../../../shared/artifact-sharing-gate'

export const SKILL_LIBRARY_METHODS = [
  defineMethod({
    name: 'skills.library.discoverUrl',
    params: SkillLibraryLinkParams,
    handler: (params, { runtime }) =>
      discoverLinkedSkills(runtime.getLocalSkillLibrary().library, params.url)
  }),
  defineMethod({
    name: 'skills.library.previewVersion',
    params: SkillLibraryVersionPreviewParams,
    handler: (params, { runtime }) =>
      previewLibraryVersion(
        runtime.getLocalSkillLibrary().library,
        params.versionId,
        params.filePath
      )
  }),
  defineMethod({
    name: 'skills.library.listShares',
    params: null,
    handler: async (_params, { runtime }) => {
      const hosting = await runtime.getArtifactHostingStatus()
      if (hosting.backend !== 'local' || !hosting.viewerOrigin) {
        return { supported: false, enabled: false, shares: [] }
      }
      const library = runtime.getLocalSkillLibrary().library
      const catalog = await library.store.snapshot()
      return {
        supported: true,
        enabled: hosting.sharingEnabled,
        shares: (catalog.shares ?? []).map((share) => ({
          id: share.id,
          url: localSkillShareUrl(hosting.viewerOrigin!, basename(library.store.root), share),
          packageId: share.manifest.packageId,
          name: share.manifest.bundleName,
          description: share.manifest.description,
          createdAt: share.createdAt,
          names: share.manifest.skills.map((skill) => skill.name)
        }))
      }
    }
  }),
  defineMethod({
    name: 'skills.library.share',
    params: LocalSkillPublishParams,
    handler: async (params, { runtime, clientKind }) => {
      if (clientKind === undefined) {
        runtime.assertAgentSkillSharingAllowed()
      }
      const hosting = await runtime.getArtifactHostingStatus()
      if (hosting.backend !== 'local' || !hosting.viewerOrigin) {
        throw new Error('Server-local hosting is unavailable. No Cloud upload was attempted.')
      }
      if (!hosting.sharingEnabled) {
        throw new ArtifactSharingDisabledError()
      }
      const library = runtime.getLocalSkillLibrary().library
      const share = await publishLibrarySkills(library, params)
      return {
        id: share.id,
        url: localSkillShareUrl(hosting.viewerOrigin, basename(library.store.root), share),
        packageDigest: share.manifest.bundleDigest
      }
    }
  }),
  defineMethod({
    name: 'skills.library.revokeShare',
    params: LocalSkillRevokeParams,
    handler: (params, { runtime }) =>
      revokeLibraryShare(runtime.getLocalSkillLibrary().library, params.shareId)
  }),
  defineMethod({
    name: 'skills.library.list',
    params: null,
    handler: async (_params, { runtime }) => ({
      ...(await runtime.getLocalSkillLibrary().library.store.snapshot()),
      hosts: skillLibraryHosts(),
      providers: skillLibraryProviders(),
      workspaces: await runtime.listSkillLibraryWorkspaces()
    })
  }),
  defineMethod({
    name: 'skills.library.discover',
    params: SkillLibraryDiscoverParams,
    handler: async (params) => ({
      hostId: params.hostId,
      candidates: await skillLibrarySource(params.hostId).discover()
    })
  }),
  defineMethod({
    name: 'skills.library.preview',
    params: SkillLibraryPreviewParams,
    handler: (params, { runtime }) =>
      runtime
        .getLocalSkillLibrary()
        .library.preview(
          params.hostId.startsWith('url:')
            ? resolveLinkSkillSource(runtime.getLocalSkillLibrary().library, params.hostId)
            : skillLibrarySource(params.hostId),
          params.candidateId,
          params.filePath
        )
  }),
  defineMethod({
    name: 'skills.library.import',
    params: SkillLibraryImportParams,
    handler: (params, { runtime }) =>
      runtime
        .getLocalSkillLibrary()
        .library.importSelected(
          params,
          params.hostId.startsWith('url:')
            ? resolveLinkSkillSource(runtime.getLocalSkillLibrary().library, params.hostId)
            : skillLibrarySource(params.hostId)
        )
  }),
  defineMethod({
    name: 'skills.library.assign',
    params: SkillLibraryAssignParams,
    handler: (params, { runtime }) => runtime.getLocalSkillLibrary().assignments.assign(params)
  }),
  defineMethod({
    name: 'skills.library.unassign',
    params: SkillLibraryAssignmentParams,
    handler: (params, { runtime }) =>
      runtime.getLocalSkillLibrary().assignments.unassign(params.assignmentId)
  }),
  defineMethod({
    name: 'skills.library.reconcile',
    params: SkillLibraryReconcileParams,
    handler: (params, { runtime }) =>
      runtime.getLocalSkillLibrary().assignments.reconcile(params.assignmentId)
  }),
  defineMethod({
    name: 'skills.library.deleteVersion',
    params: SkillLibraryVersionParams,
    handler: (params, { runtime }) =>
      runtime.getLocalSkillLibrary().library.deleteVersion(params.versionId)
  })
]
