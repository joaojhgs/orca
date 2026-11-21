import { z } from 'zod'

const Coordinate = z.number().int().min(0).max(65535)
const Position = { x: Coordinate, y: Coordinate }
export const VncAgentAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('screenshot') }).strict(),
  z.object({ kind: z.literal('move'), ...Position }).strict(),
  z
    .object({
      kind: z.literal('click'),
      ...Position,
      button: z.enum(['left', 'middle', 'right']).default('left'),
      count: z.number().int().min(1).max(3).default(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal('scroll'),
      ...Position,
      direction: z.enum(['up', 'down', 'left', 'right']),
      steps: z.number().int().min(1).max(20).default(1)
    })
    .strict(),
  z.object({ kind: z.literal('drag'), ...Position, toX: Coordinate, toY: Coordinate }).strict(),
  z.object({ kind: z.literal('key'), key: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('type'), text: z.string().min(1).max(4096) }).strict()
])
export type VncAgentAction = z.infer<typeof VncAgentAction>
export const ComputerDesktopActionParams = z
  .object({
    desktopId: z.string().min(1).max(1500),
    action: VncAgentAction
  })
  .strict()
