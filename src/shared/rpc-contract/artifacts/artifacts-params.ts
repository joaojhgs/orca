import { isUtf8ByteLengthWithinLimit } from '../../text/utf8-byte-limits'
import { z } from 'zod'
import {
  LOCAL_ARTIFACT_MAX_CONTENT_BYTES,
  LOCAL_ARTIFACT_MAX_REQUEST_BYTES,
  artifactWriteRequestByteLength
} from '../../artifacts/artifacts'

export const CloudOptions = {
  apiUrl: z.string().max(2_048).optional(),
  authToken: z.string().max(16_384).optional()
}

export const ListOptions = z.object({
  ...CloudOptions,
  cursor: z.string().min(1).max(2_048).optional()
})

export const SourceRequest = z.object({
  sourceKey: z.string().min(1).max(32_768),
  ...CloudOptions
})

export const StagedWriteRequest = z.object({
  sourceKey: z.string().min(1).max(32_768),
  content: z
    .string()
    .min(1)
    .max(LOCAL_ARTIFACT_MAX_CONTENT_BYTES)
    .refine((content) => isUtf8ByteLengthWithinLimit(content, LOCAL_ARTIFACT_MAX_CONTENT_BYTES), {
      message: 'Artifact content exceeds the 64 MiB limit.'
    }),
  contentType: z.enum(['text/html', 'text/markdown', 'application/pdf']),
  fileName: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  ...CloudOptions
})

export const WriteRequest = StagedWriteRequest.refine(
  (request) => artifactWriteRequestByteLength(request) <= LOCAL_ARTIFACT_MAX_REQUEST_BYTES,
  {
    message: 'Artifact request exceeds the supported size.'
  }
)

export const ArtifactsDeleteParams = z.object({ id: z.string().min(1), ...CloudOptions })
