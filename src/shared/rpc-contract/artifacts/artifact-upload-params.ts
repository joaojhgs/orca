import { z } from 'zod'
import { LOCAL_ARTIFACT_MAX_REQUEST_BYTES } from '../../artifacts/artifacts'
export const ArtifactUploadStart = z.object({
  totalBytes: z.number().int().min(1).max(LOCAL_ARTIFACT_MAX_REQUEST_BYTES)
})
export const ArtifactUploadId = z.object({ uploadId: z.string().min(1).max(128) })
export const ArtifactUploadAppend = ArtifactUploadId.extend({
  offset: z.number().int().min(0),
  contentBase64: z
    .string()
    .min(1)
    .max(256 * 1024)
})
