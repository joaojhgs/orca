import { z } from 'zod'
import { SkillLibraryCandidateSchema, SkillLibraryHostSchema } from './skill-library-contract'

export { SKILL_LIBRARY_LINK_CAPABILITY } from './skill-library-link-capability'
export const SkillLibraryLinkParams = z.object({ url: z.url().max(2048) })
export const SkillLibraryLinkResultSchema = z.object({
  hostId: SkillLibraryHostSchema,
  label: z.string(),
  candidates: z.array(SkillLibraryCandidateSchema).max(500)
})
