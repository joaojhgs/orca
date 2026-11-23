import { defineMethod } from '../../core'
import {
  ArtifactUploadStart,
  ArtifactUploadId,
  ArtifactUploadAppend
} from '../../../../../shared/rpc-contract/artifacts/artifact-upload-params'
import { StagedWriteRequest } from '../../../../../shared/rpc-contract/artifacts/artifacts-params'
import {
  abortArtifactUpload,
  appendArtifactUpload,
  beginArtifactUpload,
  consumeArtifactUpload
} from '../../../../artifacts/artifact-upload-store'

export const ARTIFACT_UPLOAD_METHODS = [
  defineMethod({
    name: 'artifacts.uploadStart',
    permission: 'workspace',
    params: ArtifactUploadStart,
    handler: (params, { connectionId }) =>
      beginArtifactUpload(connectionId ?? 'in-process', params.totalBytes)
  }),
  defineMethod({
    name: 'artifacts.uploadAppend',
    permission: 'workspace',
    params: ArtifactUploadAppend,
    handler: async (params, { connectionId }) => {
      await appendArtifactUpload(
        connectionId ?? 'in-process',
        params.uploadId,
        params.offset,
        params.contentBase64
      )
      return { accepted: true }
    }
  }),
  defineMethod({
    name: 'artifacts.uploadCommit',
    permission: 'workspace',
    params: ArtifactUploadId,
    handler: (params, { runtime, connectionId }) =>
      consumeArtifactUpload(connectionId ?? 'in-process', params.uploadId, (request) =>
        runtime.publishArtifact(StagedWriteRequest.parse(request))
      )
  }),
  defineMethod({
    name: 'artifacts.uploadAbort',
    permission: 'workspace',
    params: ArtifactUploadId,
    handler: async (params, { connectionId }) => {
      await abortArtifactUpload(connectionId ?? 'in-process', params.uploadId)
      return { aborted: true }
    }
  })
]
