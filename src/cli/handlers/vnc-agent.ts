import { VncAgentAction } from '../../shared/vnc-agent-contract'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

export const VNC_AGENT_HANDLERS: Record<string, CommandHandler> = {
  'computer desktops': async ({ client, json }) => {
    const result = await client.call<{
      targets: { id: string; label: string; viewOnly: boolean }[]
      unavailableHosts?: string[]
    }>('computer.desktopTargets', { executionHosts: true })
    printResult(
      result,
      json,
      (value) =>
        [
          ...value.targets.map(
            (target) =>
              `${target.id}  ${target.label} (${target.viewOnly ? 'view-only' : 'control'})`
          ),
          ...(value.unavailableHosts?.length
            ? [`Unverifiable hosts: ${value.unavailableHosts.join(', ')}`]
            : [])
        ].join('\n') || 'No approved VNC desktops are reachable.'
    )
  },
  'computer desktop-screenshot': async ({ flags, client, json }) => {
    const result = await client.call<{
      desktopId: string
      width: number
      height: number
      pngBase64: string
    }>(
      'computer.desktopAction',
      {
        desktopId: getRequiredStringFlag(flags, 'desktop'),
        action: { kind: 'screenshot' }
      },
      { timeoutMs: 90000 }
    )
    // Inline bytes cross the relay; a controller-local screenshot path is unusable to the worker.
    printResult(
      result,
      json,
      (value) => `${value.desktopId}: ${value.width}x${value.height}; use --json for PNG bytes`
    )
  },
  'computer desktop-input': async ({ flags, client, json }) => {
    const desktopId = getRequiredStringFlag(flags, 'desktop')
    const input: Record<string, unknown> = { kind: getRequiredStringFlag(flags, 'action') }
    const keys: Record<string, string> = { 'to-x': 'toX', 'to-y': 'toY' }
    const numeric = new Set(['x', 'y', 'to-x', 'to-y', 'count', 'steps'])
    for (const name of [
      'x',
      'y',
      'to-x',
      'to-y',
      'key',
      'text',
      'button',
      'count',
      'direction',
      'steps'
    ]) {
      const value = flags.get(name)
      if (value !== undefined) {
        input[keys[name] ?? name] = numeric.has(name) ? Number(value) : value
      }
    }
    const parsed = VncAgentAction.safeParse(input)
    if (!parsed.success || parsed.data.kind === 'screenshot') {
      throw new RuntimeClientError(
        'invalid_argument',
        'Invalid desktop input flags; see computer desktop-input --help'
      )
    }
    const result = await client.call(
      'computer.desktopAction',
      { desktopId, action: parsed.data },
      { timeoutMs: 90000 }
    )
    printResult(
      result,
      json,
      () =>
        'Input delivered; its effect is unverified. Capture a fresh screenshot before continuing.'
    )
  }
}
