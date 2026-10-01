import { defineMethod } from '../core'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { ensureActiveOrcaProfile } from '../../../orca-profiles/profile-index-store'
import { getOrcaProfileAuthStatusFromProfile } from '../../../orca-profiles/profile-cloud-auth-status'
import {
  ArtifactsDeleteParams,
  ListOptions,
  SourceRequest,
  WriteRequest
} from '../../../../shared/rpc-contract/artifacts-params'

export const ARTIFACT_METHODS = [
  defineMethod({
    name: 'artifacts.authStatus',
    params: null,
    handler: () => {
      const path = getAppEnvironment().getPath('userData')
      return getOrcaProfileAuthStatusFromProfile(ensureActiveOrcaProfile(path), path)
    }
  }),
  defineMethod({
    name: 'artifacts.list',
    params: ListOptions,
    handler: (params, { runtime }) => runtime.listArtifacts(params)
  }),
  defineMethod({
    name: 'artifacts.getPublishedLink',
    params: SourceRequest,
    handler: (params, { runtime }) => runtime.getPublishedArtifactLink(params)
  }),
  defineMethod({
    name: 'artifacts.share',
    params: WriteRequest,
    handler: (params, { runtime }) => runtime.shareArtifact(params)
  }),
  defineMethod({
    name: 'artifacts.publish',
    params: WriteRequest,
    handler: (params, { runtime }) => runtime.publishArtifact(params)
  }),
  defineMethod({
    name: 'artifacts.update',
    params: WriteRequest,
    handler: (params, { runtime }) => runtime.updateArtifact(params)
  }),
  defineMethod({
    name: 'artifacts.unshare',
    params: SourceRequest,
    handler: (params, { runtime }) => runtime.unshareArtifact(params)
  }),
  defineMethod({
    name: 'artifacts.delete',
    params: ArtifactsDeleteParams,
    handler: (params, { runtime }) => runtime.deleteArtifact(params.id, params)
  })
]
