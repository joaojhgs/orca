import * as z from 'zod'

/** A client of an existing Hermes profile, not a copy of its persona, memory or credentials. */
export const HermesProfileLinkSchema = z.object({
  connectionId: z.string().min(1).max(256),
  profile: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  home: z
    .string()
    .startsWith('/')
    .max(4096)
    .refine((value) => !/[\r\n\0]/.test(value)),
  directory: z
    .string()
    .startsWith('/')
    .max(4096)
    .refine((value) => !/[\r\n\0]/.test(value))
})

export type HermesProfileLink = z.infer<typeof HermesProfileLinkSchema>
