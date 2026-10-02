import { defineMethod } from '../core'
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
  SkillLibraryVersionParams
} from '../../../../shared/skill-library-contract'

export const SKILL_LIBRARY_METHODS = [
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
        .library.preview(skillLibrarySource(params.hostId), params.candidateId, params.filePath)
  }),
  defineMethod({
    name: 'skills.library.import',
    params: SkillLibraryImportParams,
    handler: (params, { runtime }) =>
      runtime
        .getLocalSkillLibrary()
        .library.importSelected(params, skillLibrarySource(params.hostId))
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
