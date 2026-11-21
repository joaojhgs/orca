import type { AiVaultSession } from '../../shared/ai-vault/contracts/ai-vault-types'
import type { ExecutionHostId } from '../../shared/execution-host/execution-host'
import type { FileWithMtime } from './session-scanner-types'
import {
  remoteSessionContentLines,
  type RemoteSessionContent
} from './transcripts/remote-session-content-lines'
import { createAccumulator, finalizeSession } from './parsing/session-scanner-accumulator'
import { museSessionIdFromFilePath } from './scanners/muse/session-scanner-muse-paths'
import { foldMuseLines } from './scanners/muse/session-scanner-muse-parser'
import { parseCodexSessionLines } from './scanners/codex/session-scanner-codex-parser'
import { parseDroidSessionLines } from './scanners/droid/session-scanner-droid-parser'
import { parseCodebuddySessionLines } from './scanners/codebuddy/session-scanner-codebuddy-parser'
import { parseCopilotSessionLines } from './scanners/copilot/session-scanner-copilot-parser'
type ParserSessionOptions = {
  executionHostId?: ExecutionHostId
  executionHostPlatform?: NodeJS.Platform | null
}

export async function parseCodexSessionContent(args: {
  file: FileWithMtime
  content: string | AsyncIterable<string>
  platform?: NodeJS.Platform
  codexHome?: string | null
  executionHostId?: ExecutionHostId
  executionHostPlatform?: NodeJS.Platform | null
  readIndexedTitle?: (sessionId: string) => Promise<string | null>
  signal?: AbortSignal
}): Promise<AiVaultSession | null> {
  return parseCodexSessionLines({
    file: args.file,
    lines: remoteSessionContentLines(args.content, args.signal),
    platform: args.platform ?? process.platform,
    codexHome: args.codexHome ?? null,
    executionHostId: args.executionHostId,
    executionHostPlatform: args.executionHostPlatform,
    titleReader: args.readIndexedTitle
  })
}

export async function parseDroidSessionContent(
  file: FileWithMtime,
  content: RemoteSessionContent,
  platform: NodeJS.Platform = process.platform,
  options: ParserSessionOptions = {},
  signal?: AbortSignal
): Promise<AiVaultSession | null> {
  return parseDroidSessionLines({
    file,
    lines: remoteSessionContentLines(content, signal),
    platform,
    options
  })
}

export async function parseCodebuddySessionContent(
  file: FileWithMtime,
  content: RemoteSessionContent,
  platform: NodeJS.Platform = process.platform,
  options: ParserSessionOptions = {},
  signal?: AbortSignal
): Promise<AiVaultSession | null> {
  return parseCodebuddySessionLines({
    file,
    lines: remoteSessionContentLines(content, signal),
    platform,
    options
  })
}

export async function parseCopilotSessionContent(
  file: FileWithMtime,
  content: RemoteSessionContent,
  platform: NodeJS.Platform = process.platform,
  options: ParserSessionOptions = {},
  signal?: AbortSignal
): Promise<AiVaultSession | null> {
  return parseCopilotSessionLines({
    file,
    lines: remoteSessionContentLines(content, signal),
    platform,
    options
  })
}

export async function parseMuseSessionRemoteContent(
  file: FileWithMtime,
  content: RemoteSessionContent,
  platform: NodeJS.Platform = process.platform,
  options: ParserSessionOptions = {},
  signal?: AbortSignal
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'muse',
    file,
    sessionId: museSessionIdFromFilePath(file.path)
  })
  const lines = remoteSessionContentLines(content, signal)
  const dedupe = { text: null, ms: null }
  for await (const line of lines) {
    foldMuseLines(accumulator, [line], dedupe)
  }
  return finalizeSession(accumulator, platform, options)
}
