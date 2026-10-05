import { z } from 'zod'

export const ArtifactPublishingApprovalRequestParams = z.object({ enabled: z.boolean() }).strict()
export const ArtifactPublishingApprovalCheckParams = z
  .object({ requestId: z.string().uuid() })
  .strict()
