import { z } from 'zod'
import { isPluginDeclarativeImagePath } from './plugin-declarative-content-props'

export const pluginPanelImageRequestSchema = z
  .object({
    sessionToken: z.string().min(1).max(256),
    path: z.string().max(512).refine(isPluginDeclarativeImagePath)
  })
  .strict()
