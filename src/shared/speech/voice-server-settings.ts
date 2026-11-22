import { z } from 'zod'
import { MAX_DICTATION_TERMS, MAX_DICTATION_TERM_LENGTH } from './dictation/dictation-dictionary'

/** Host inference settings; excludes filesystem paths, credentials and browser input devices. */
export const VoiceServerSettingsSchema = z.object({
  enabled: z.boolean(),
  sttModel: z.string().max(256),
  dictationLanguage: z.string().max(32),
  removeFillerWords: z.boolean(),
  unloadModelAfterMinutes: z.number().finite().min(0).max(10080).nullable(),
  speechGpu: z.enum(['auto', 'off']).optional(),
  dictationTerms: z
    .array(
      z
        .object({
          term: z.string().trim().min(1).max(MAX_DICTATION_TERM_LENGTH),
          heardAs: z.string().max(MAX_DICTATION_TERM_LENGTH).optional(),
          hint: z.literal(true).optional()
        })
        .strict()
    )
    .max(MAX_DICTATION_TERMS)
    .optional(),
  dictationRepoNameHint: z.boolean().optional(),
  aiCleanup: z.boolean().optional(),
  aiCleanupConsentAgent: z.string().max(256).optional(),
  aiCleanupInstructions: z.string().max(100000).optional(),
  dictationCorrectionWord: z.string().max(256).optional()
})

export const VoiceServerSettingsUpdate = VoiceServerSettingsSchema.partial().strict()
export type VoiceServerSettingsPatch = z.infer<typeof VoiceServerSettingsUpdate>
