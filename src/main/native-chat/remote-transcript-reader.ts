import type { IFilesystemProvider } from '../providers/types'
import type {
  AgentType,
  NativeChatMessage,
  NativeChatTurnLifecycle
} from '../../shared/native-chat-types'
import { nativeChatLineDecoderForAgent } from './transcript-tail-reader'
import { nativeChatTurnLifecycleDecoderForAgent } from './transcript-turn-lifecycle'
import { transcriptFallbackId } from './transcript-fallback-id'

export type RemoteTranscriptTail = {
  messages: NativeChatMessage[]
  lifecycle?: NativeChatTurnLifecycle
  hasMore: boolean
  beforeOffset: number
}

export async function readRemoteTranscriptTail(args: {
  provider: IFilesystemProvider
  path: string
  agent: AgentType
  limit: number
  beforeOffset?: number
}): Promise<RemoteTranscriptTail | { error: string }> {
  const decode = nativeChatLineDecoderForAgent(args.agent)
  if (!decode) {
    return { error: 'Transcript unavailable' }
  }
  try {
    const read = await args.provider.readFile(args.path)
    if (read.isBinary) {
      return { error: 'Transcript unavailable' }
    }
    const bytes = Buffer.from(read.content, 'utf8')
    const end = Math.min(bytes.length, args.beforeOffset ?? bytes.length)
    const lines = bytes.subarray(0, end).toString('utf8').split('\n')
    const decoded: { message: NativeChatMessage; offset: number }[] = []
    const decodeLifecycle = nativeChatTurnLifecycleDecoderForAgent(args.agent)
    let lifecycle: NativeChatTurnLifecycle | undefined
    let offset = 0
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      const lineBytes = Buffer.byteLength(rawLine, 'utf8') + 1
      if (line) {
        const fallbackId = transcriptFallbackId(args.path, offset)
        lifecycle = decodeLifecycle?.(line, fallbackId) ?? lifecycle
        const message = decode(line, fallbackId)
        if (message) {
          decoded.push({ message, offset })
        }
      }
      offset += lineBytes
    }
    const selected = decoded.slice(-args.limit)
    return {
      messages: selected.map((item) => item.message),
      ...(args.beforeOffset === undefined && lifecycle ? { lifecycle } : {}),
      hasMore: decoded.length > selected.length,
      beforeOffset: selected[0]?.offset ?? end
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function subscribeRemoteTranscript(args: {
  provider: IFilesystemProvider
  path: string
  agent: AgentType
  limit: number
  onResult: (result: RemoteTranscriptTail, first: boolean) => void
  onInitialError: (error: string) => void
}): Promise<() => void> {
  let closed = false
  let reading = false
  let emitted = false
  let previousVersion = ''
  const read = async (force = false): Promise<void> => {
    if (closed || reading) {
      return
    }
    reading = true
    let nextVersion = previousVersion
    try {
      const stat = await args.provider.stat(args.path)
      const version = `${stat.size}:${stat.mtimeMs ?? stat.mtime}`
      if (!force && version === previousVersion) {
        return
      }
      nextVersion = version
    } catch {
      if (emitted) {
        return
      }
    } finally {
      reading = false
    }
    if (closed) {
      return
    }
    reading = true
    const result = await readRemoteTranscriptTail(args)
    reading = false
    if (closed) {
      return
    }
    if (!('messages' in result)) {
      if (!emitted) {
        args.onInitialError(result.error)
        emitted = true
      }
      return
    }
    const first = !emitted
    emitted = true
    previousVersion = nextVersion
    args.onResult(result, first)
  }
  const timer = setInterval(() => void read(), 750)
  timer.unref?.()
  await read(true)
  return () => {
    closed = true
    clearInterval(timer)
  }
}
