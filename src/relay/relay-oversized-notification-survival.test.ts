import { describe, expect, it } from 'vitest'
import { AGENT_SUBAGENT_ID_MAX_LENGTH } from '../shared/agent-status/contracts/agent-status-subagent-snapshot'
import { RelayDispatcher } from '../wsl-guest/transport/publication/dispatcher'
import { relayWriterControlReserve } from '../wsl-guest/transport/writer/dispatcher-writer-admission'
import { HEADER_LENGTH } from '../shared/remote-runtime/relay/relay-frame-decoder'
import { encodeJsonRpcFrame, parseJsonRpcMessage } from '../wsl-guest/transport/wire/protocol'
import {
  AGENT_HOOK_NOTIFICATION_METHOD,
  type AgentHookRelayEnvelope
} from '../shared/agent-hook-listener/transport/agent-hook-relay'
import { MAX_BATCHED_WATCHER_EVENTS } from '../main/ipc/filesystem/watchers/filesystem-watcher-event-batch'
import { emitRelayWatcherEvents } from './relay-watcher-event-emitter'
import { publishAgentHookEnvelope } from '../wsl-guest/agent-hooks/publication/agent-hook-envelope-publication'
import type { WatcherProcessEvent } from '../main/ipc/filesystem/watcher-process/parcel-watcher-process-protocol'
import {
  AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH,
  AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH,
  normalizeAgentStatusPayload
} from '../shared/agent-status/contracts/agent-status-types'

// The relay runs on the REMOTE host, so the stream default is that host's Node major.
const NODE22_HWM = 64 * 1024 // Node >= 22 default
const NODE21_HWM = 16 * 1024 // Node <= 21 default

const WATCHER_ROOT = '/home/dev/project'

function capacityFor(hwm: number): number {
  return hwm - relayWriterControlReserve(hwm)
}

/** Keep one valid payload between the two sink limits so the older tier must shed fields. */
function buildLargeHookEnvelope(): AgentHookRelayEnvelope {
  const payload = normalizeAgentStatusPayload({
    state: 'waiting',
    prompt: 'x'.repeat(200),
    interactivePrompt: 'q'.repeat(AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH),
    lastAssistantMessage: 'a'.repeat(AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH),
    toolName: 'Bash',
    toolInput: 'i'.repeat(160),
    model: 'claude-opus-5',
    agentType: 'general-purpose',
    subagents: Array.from({ length: 64 }, (_, i) => ({
      id: `subagent-${i}`.padEnd(AGENT_SUBAGENT_ID_MAX_LENGTH, '0'),
      state: 'working',
      agentType: 'general-purpose',
      model: 'claude-opus-5',
      description: 'i'.repeat(160)
    }))
  })
  if (payload === null) {
    throw new Error('The agent hook normalizer rejected the fixture')
  }
  return {
    source: 'claude',
    paneKey: 'worktree-abc:0f2c1d84-3b9a-4c77-9d21-5e6f7a8b9c0d',
    connectionId: null,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    hookEventName: 'Notification',
    payload
  }
}

function watcherProcessEvents(count: number): WatcherProcessEvent[] {
  return Array.from({ length: count }, (_, i): WatcherProcessEvent => ({
    type: 'update',
    path: `${WATCHER_ROOT}/node_modules/.vite/deps/chunk-${String(i).padStart(6, '0')}.js`
  }))
}

/** The exact `fs.changed` params emitRelayWatcherEvents publishes, so the pinned sizes measure reality. */
function buildWatcherBatch(count: number): Record<string, unknown> {
  return {
    events: watcherProcessEvents(count).map((event) => ({
      kind: event.type,
      absolutePath: event.path
    }))
  }
}

function frameBytes(method: string, params: Record<string, unknown>): number {
  return encodeJsonRpcFrame({ jsonrpc: '2.0', method, params }, 1, 0).length
}

function frameParams(frame: Buffer): Record<string, unknown> {
  const payloadLength = frame.readUInt32BE(9)
  const message = parseJsonRpcMessage(frame.subarray(HEADER_LENGTH, HEADER_LENGTH + payloadLength))
  return 'method' in message ? (message.params ?? {}) : {}
}

function createDispatcher(hwm: number, onClose: () => void, sink: Buffer[]): RelayDispatcher {
  return new RelayDispatcher(
    (data: Buffer) => {
      sink.push(data)
      return true
    },
    {
      writableHighWaterMark: () => hwm,
      writableLength: () => 0,
      supportsWriteCallback: false,
      close: onClose
    }
  )
}

describe('relay oversized notification survival', () => {
  // Without this the byte measurements below could describe a payload the emitter never sends.
  it('measures the params emitRelayWatcherEvents actually publishes', () => {
    const sink: Buffer[] = []
    const dispatcher = createDispatcher(NODE22_HWM, () => {}, sink)

    try {
      emitRelayWatcherEvents(dispatcher, WATCHER_ROOT, false, watcherProcessEvents(1))
      expect(sink).toHaveLength(1)
      expect(frameParams(sink[0])).toEqual(buildWatcherBatch(1))
    } finally {
      dispatcher.dispose()
    }
  })

  it('measures both producers against both Node tiers', () => {
    const hookBytes = frameBytes(AGENT_HOOK_NOTIFICATION_METHOD, buildLargeHookEnvelope())
    const fullBatchBytes = frameBytes('fs.changed', buildWatcherBatch(MAX_BATCHED_WATCHER_EVENTS))

    // Binary-search the largest watcher batch that still fits each tier.
    const trip = (cap: number): number => {
      let lo = 1
      let hi = MAX_BATCHED_WATCHER_EVENTS
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (frameBytes('fs.changed', buildWatcherBatch(mid)) <= cap) {
          lo = mid
        } else {
          hi = mid - 1
        }
      }
      return lo
    }

    // Capacity is a fixed fraction of the sink's high-water mark, so these are exact.
    expect(capacityFor(NODE22_HWM)).toBe(49152)
    expect(capacityFor(NODE21_HWM)).toBe(12288)

    // agent.hook: fits a modern remote, over-cap on an older one — which is why the remote's
    // Node major, not Orca's, decides whether a large envelope has to shed.
    expect(hookBytes).toBeLessThan(capacityFor(NODE22_HWM))
    expect(hookBytes).toBeGreaterThan(capacityFor(NODE21_HWM))

    // fs.changed: the batch cap is orders of magnitude above what one frame can carry, on BOTH tiers.
    expect(fullBatchBytes).toBeGreaterThan(capacityFor(NODE22_HWM))
    expect(trip(capacityFor(NODE22_HWM)) * 5).toBeLessThan(MAX_BATCHED_WATCHER_EVENTS)
    expect(trip(capacityFor(NODE21_HWM))).toBeLessThan(trip(capacityFor(NODE22_HWM)))
  })

  it('a 5000-event fs.changed no longer closes the client on a Node>=22-sized sink', () => {
    const sink: Buffer[] = []
    let closes = 0
    const dispatcher = createDispatcher(NODE22_HWM, () => (closes += 1), sink)

    try {
      dispatcher.notify('pty.exit', { id: 'pty-1', exitCode: 0 })
      const before = sink.length
      expect(before).toBeGreaterThan(0)

      // The batch the registry is configured to allow (maxEventsPerBatch = MAX_BATCHED_WATCHER_EVENTS).
      emitRelayWatcherEvents(
        dispatcher,
        WATCHER_ROOT,
        false,
        watcherProcessEvents(MAX_BATCHED_WATCHER_EVENTS)
      )
      expect(closes).toBe(0)
      expect(sink.length).toBeGreaterThan(before)
      expect(sink.every((frame) => frame.length <= capacityFor(NODE22_HWM))).toBe(true)

      // The link is still live: the next frame reaches the sink.
      const afterBatch = sink.length
      dispatcher.notify('pty.exit', { id: 'pty-2', exitCode: 0 })
      expect(sink.length).toBe(afterBatch + 1)
    } finally {
      dispatcher.dispose()
    }
  })

  it('a large agent.hook envelope survives a Node<=21-sized sink through publishAgentHookEnvelope', () => {
    const sink: Buffer[] = []
    let closes = 0
    const dispatcher = createDispatcher(NODE21_HWM, () => (closes += 1), sink)

    try {
      publishAgentHookEnvelope(dispatcher, buildLargeHookEnvelope())

      expect(closes).toBe(0)
      expect(sink).toHaveLength(1)
      expect(sink[0].length).toBeLessThanOrEqual(capacityFor(NODE21_HWM))

      const params = frameParams(sink[0])
      expect(params.paneKey).toBe('worktree-abc:0f2c1d84-3b9a-4c77-9d21-5e6f7a8b9c0d')
      expect(params.connectionId).toBeNull()
      expect(params.payload).toMatchObject({ state: 'waiting' })
      expect(params.payload).not.toHaveProperty('lastAssistantMessage')
    } finally {
      dispatcher.dispose()
    }
  })

  it('reattach + replay does not re-kill', () => {
    const sink: Buffer[] = []
    let killCloses = 0
    let retiredSinkCloses = 0
    let replacingSink = false
    // setWrite deliberately closes the sink it retires; only a close on the LIVE sink is a kill.
    const onClose = (): void => {
      if (replacingSink) {
        retiredSinkCloses += 1
      } else {
        killCloses += 1
      }
    }
    const dispatcher = createDispatcher(NODE21_HWM, onClose, sink)
    const envelope = buildLargeHookEnvelope()

    try {
      publishAgentHookEnvelope(dispatcher, envelope)
      expect(sink).toHaveLength(1)

      for (let reconnect = 0; reconnect < 4; reconnect += 1) {
        // Real reattach: relay.ts swaps the sink onto the new SSH channel, then the
        // hook server replays its per-paneKey cache (agent-hook-server.ts).
        replacingSink = true
        dispatcher.setWrite(
          (data: Buffer) => {
            sink.push(data)
            return true
          },
          {
            writableHighWaterMark: () => NODE21_HWM,
            writableLength: () => 0,
            supportsWriteCallback: false,
            close: onClose
          }
        )
        replacingSink = false
        publishAgentHookEnvelope(dispatcher, envelope)
      }

      expect(killCloses).toBe(0)
      expect(retiredSinkCloses).toBe(4)
      expect(sink).toHaveLength(5)
    } finally {
      dispatcher.dispose()
    }
  })
})
