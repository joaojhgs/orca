import { z } from 'zod'

// Leave room for the encrypted runtime's 4 MiB reply envelope.
export const ANDROID_PREVIEW_MAX_BASE64_CHARACTERS = 3 * 1024 * 1024

export const AndroidPreviewApproval = z
  .object({
    usb: z.boolean().default(false),
    emulators: z.boolean().default(false),
    serials: z.array(z.string().min(1).max(256)).max(16).default([])
  })
  .strict()

const Serial = z.string().min(1).max(256)
const Package = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/)
  .max(256)
export const AndroidPreviewAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z.object({ kind: z.literal('screenshot'), serial: Serial }).strict(),
  z.object({ kind: z.literal('ax'), serial: Serial }).strict(),
  z
    .object({
      kind: z.literal('logcat'),
      serial: Serial,
      lines: z.number().int().min(1).max(2000).default(200)
    })
    .strict(),
  z
    .object({
      kind: z.literal('launch'),
      serial: Serial,
      package: Package,
      activity: z
        .string()
        .regex(/^[A-Za-z_.][A-Za-z0-9_.$]*$/)
        .max(256)
        .optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('permissions'),
      serial: Serial,
      op: z.enum(['grant', 'revoke']),
      package: Package,
      permission: Package
    })
    .strict(),
  z
    .object({
      kind: z.literal('tap'),
      serial: Serial,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal('gesture'),
      serial: Serial,
      points: z
        .array(
          z.object({
            type: z.enum(['begin', 'move', 'end']),
            edge: z.number().optional(),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1)
          })
        )
        .min(2)
        .max(64)
    })
    .strict(),
  z.object({ kind: z.literal('type'), serial: Serial, text: z.string().max(16384) }).strict(),
  z.object({ kind: z.literal('button'), serial: Serial, name: z.string().max(80) }).strict(),
  z
    .object({
      kind: z.literal('rotate'),
      serial: Serial,
      orientation: z.enum(['portrait', 'portrait_upside_down', 'landscape_left', 'landscape_right'])
    })
    .strict()
])
export const AndroidPreviewRequest = z
  .object({
    operation: z.literal('android-preview'),
    approval: AndroidPreviewApproval,
    action: AndroidPreviewAction
  })
  .strict()
export type AndroidPreviewRequest = z.infer<typeof AndroidPreviewRequest>
export type AndroidPreviewApproval = z.infer<typeof AndroidPreviewApproval>
export type AndroidPreviewAction = z.infer<typeof AndroidPreviewAction>

export const AndroidPreviewResult = z.union([
  z.object({
    devices: z
      .array(
        z.object({
          serial: Serial,
          label: z.string().max(256),
          state: z.enum(['device', 'offline', 'unauthorized']),
          isEmulator: z.boolean()
        })
      )
      .max(128)
  }),
  z.object({ pngBase64: z.string().max(ANDROID_PREVIEW_MAX_BASE64_CHARACTERS) }),
  z.object({
    xml: z
      .string()
      .min(1)
      .max(256 * 1024)
  }),
  z.object({
    entries: z
      .array(
        z.object({
          timestamp: z.string().max(100).optional(),
          level: z.string().max(10).optional(),
          tag: z.string().max(4096).optional(),
          message: z.string().max(256 * 1024)
        })
      )
      .max(2000)
  }),
  z.object({ ok: z.literal(true) })
])
