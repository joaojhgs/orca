import {
  ANTIGRAVITY_HISTORY_ROOTS,
  type AntigravitySessionOrigin
} from '../../shared/agent-session/lifecycle/provider-handles/antigravity-session-origin'
import { parseQoderSessionContent } from './scanners/qoder/session-scanner-qoder-parser'
import { remoteSessionDocumentParsers } from './remote-session-document-parsers'
import type { RemoteSessionContent } from './transcripts/remote-session-content-lines'
import type { AiVaultAgent, AiVaultSession } from '../../shared/ai-vault/contracts/ai-vault-types'
import { joinRemotePath, type RemoteHostPlatform } from '../ssh/remote-host/ssh-remote-platform'
import { parseAntigravitySessionContent } from './scanners/antigravity/session-scanner-antigravity-parser'
import { isAntigravityTranscriptPath } from './scanners/antigravity/session-scanner-antigravity-paths'
import {
  parseDroidSessionContent,
  parseCodebuddySessionContent,
  parseCopilotSessionContent
} from './remote-session-legacy-parsers'
import { parseClaudeSessionContent } from './scanners/claude/session-scanner-primary-parsers'
import { parseGeminiSessionContent } from './scanners/gemini/session-scanner-gemini-parsers'
import { parseCursorSessionContent } from './scanners/cursor/session-scanner-cursor-parser'
import { parseHermesSessionContent } from './session-scanner-hermes-parser'
import { parseJcodeSessionContent } from './scanners/jcode/session-scanner-jcode-parser'
import { partitionSubagentTranscriptPaths } from './scanners/claude/session-scanner-subagent-transcripts'
import { partitionOmpSubagentTranscriptPaths } from './scanners/omp/session-scanner-omp-subagent-transcripts'
import {
  ompParser,
  openClawParser,
  parseMuseRemoteContent,
  piParser,
  primeAgentParser,
  remoteOmpSessionsSegments,
  remotePathSegments,
  remotePiSessionsSegments,
  remotePrimeAgentSessionsSegments
} from './remote-session-scanner-source-parsers'
import type { FileWithMtime } from './session-scanner-types'
import { openClawSessionDirectoryPredicate } from './scanners/openclaw/openclaw-session-layout'
import { remoteCodexSources } from './remote-session-scanner-codex-sources'
import { remoteClineSource } from './remote-session-scanner-cline-source'
import { remoteKiroSource } from './remote-session-scanner-kiro-source'
import { remoteDevinSource } from './remote-session-scanner-devin-source'
import type {
  RemoteParserOptions,
  RemoteScannerContext,
  RemoteSessionSource
} from './remote-session-scanner-types'

type RemoteContentParser<T = string> = (
  file: FileWithMtime,
  content: T,
  platform: NodeJS.Platform,
  options: RemoteParserOptions,
  // Line-based parsers iterate cancellably; whole-document parsers ignore it.
  signal?: AbortSignal
) => Promise<AiVaultSession | null> | AiVaultSession | null

export function remoteSessionSources(
  remoteHome: string,
  hostPlatform: RemoteHostPlatform,
  includeAntigravityIdeSessions = false,
  kiroHomeDir?: string
): RemoteSessionSource[] {
  return [
    ...remoteCodexSources(remoteHome, hostPlatform),
    {
      ...jsonlSource(
        'claude',
        remoteHome,
        hostPlatform,
        ['.claude', 'projects'],
        parseClaudeSessionContent
      ),
      // The remote host owns the transcript disk, so the local readdir in the
      // Claude parser is skipped; the walked listing supplies the sibling
      // subagent counts instead. Partitioning also prunes the subagent
      // transcripts themselves, which would otherwise list as phantom
      // top-level sessions carrying the parent's sessionId.
      partitionSubagentTranscripts: partitionSubagentTranscriptPaths
    },
    {
      // The execution host owns CodeBuddy's transcripts, including subagent pruning.
      ...jsonlSource(
        'codebuddy',
        remoteHome,
        hostPlatform,
        ['.codebuddy', 'projects'],
        parseCodebuddySessionContent
      ),
      partitionSubagentTranscripts: partitionSubagentTranscriptPaths
    },
    {
      ...jsonlSource(
        'qoder',
        remoteHome,
        hostPlatform,
        ['.qoder', 'projects'],
        parseQoderSessionContent
      ),
      partitionSubagentTranscripts: partitionSubagentTranscriptPaths
    },
    ...(includeAntigravityIdeSessions
      ? ANTIGRAVITY_HISTORY_ROOTS
      : (['antigravity-cli'] as const)
    ).map((origin) => remoteAntigravitySource(remoteHome, hostPlatform, origin)),
    source(
      'gemini',
      remoteHome,
      hostPlatform,
      ['.gemini', 'tmp'],
      ['.json', '.jsonl'],
      parseGeminiSessionContent
    ),
    jsonlSource(
      'copilot',
      remoteHome,
      hostPlatform,
      ['.copilot', 'session-state'],
      parseCopilotSessionContent
    ),
    jsonlSource(
      'cursor',
      remoteHome,
      hostPlatform,
      ['.cursor', 'projects'],
      parseCursorSessionContent,
      (path) => remotePathSegments(path).includes('agent-transcripts')
    ),
    remoteClineSource(remoteHome, hostPlatform),
    remoteKiroSource(remoteHome, hostPlatform, kiroHomeDir),
    source(
      'hermes',
      remoteHome,
      hostPlatform,
      ['.hermes', 'sessions'],
      ['.json'],
      parseHermesSessionContent
    ),
    remoteDevinSource(remoteHome, hostPlatform),
    remoteDevinSource(remoteHome, hostPlatform, 'agent_logs'),
    source(
      'jcode',
      remoteHome,
      hostPlatform,
      ['.jcode', 'sessions'],
      ['.json'],
      parseJcodeSessionContent,
      (path) => remotePathSegments(path).pop()?.startsWith('session_') === true
    ),
    jsonlSource('pi', remoteHome, hostPlatform, remotePiSessionsSegments(), piParser),
    {
      ...jsonlSource('omp', remoteHome, hostPlatform, remoteOmpSessionsSegments(), ompParser),
      // Same posture as Claude above: OMP stores task-subagent transcripts in
      // the session's same-named artifact dir; the walk supplies counts and the
      // partition keeps the children out of the top-level list (#9330).
      partitionSubagentTranscripts: partitionOmpSubagentTranscriptPaths
    },
    jsonlSource(
      'prime-agent',
      remoteHome,
      hostPlatform,
      remotePrimeAgentSessionsSegments(),
      primeAgentParser
    ),
    jsonlSource(
      'muse',
      remoteHome,
      hostPlatform,
      ['.local', 'share', 'muse', 'sessions'],
      parseMuseRemoteContent,
      // Why: each session dir holds session.jsonl plus .log/.sqlite3 sidecars;
      // match only the transcript (same predicate as local discovery).
      (path) => remotePathSegments(path).at(-1) === 'session.jsonl'
    ),
    jsonlSource(
      'droid',
      remoteHome,
      hostPlatform,
      ['.factory', 'sessions'],
      parseDroidSessionContent
    ),
    jsonlSource(
      'droid',
      remoteHome,
      hostPlatform,
      ['.factory', 'projects'],
      parseDroidSessionContent
    ),
    ...remoteOpenClawSources(remoteHome, hostPlatform)
  ]
}

function remoteAntigravitySource(
  remoteHome: string,
  hostPlatform: RemoteHostPlatform,
  origin: AntigravitySessionOrigin
): RemoteSessionSource {
  const cliRoot = joinRemotePath(hostPlatform, remoteHome, '.gemini', origin)
  const historyPath = joinRemotePath(hostPlatform, cliRoot, 'history.jsonl')
  const parse = async (
    file: FileWithMtime,
    content: RemoteSessionContent,
    context: RemoteScannerContext
  ) => {
    const session = await parseAntigravitySessionContent(
      file,
      content,
      context.hostPlatform.os,
      parserOptions(context),
      context.signal
    )
    return session ? context.antigravityWorkspaceResolver.enrich(session, historyPath) : null
  }
  return {
    agent: 'antigravity',
    rootDir: joinRemotePath(hostPlatform, cliRoot, 'brain'),
    extensions: ['.jsonl'],
    filePredicate: isAntigravityTranscriptPath,
    fixedChildFileSegments: ['.system_generated', 'logs', 'transcript.jsonl'],
    additionalFixedChildFileSegments: [['.system_generated', 'logs', 'transcript_full.jsonl']],
    parse,
    parseLines: parse
  }
}

function source(
  agent: AiVaultAgent,
  remoteHome: string,
  hostPlatform: RemoteHostPlatform,
  segments: readonly string[],
  extensions: readonly string[],
  parseContent: RemoteContentParser,
  filePredicate?: (path: string) => boolean,
  directoryPredicate?: (name: string, depth: number) => boolean
): RemoteSessionSource {
  return {
    agent,
    rootDir: joinRemotePath(hostPlatform, remoteHome, ...segments),
    extensions,
    filePredicate,
    directoryPredicate,
    ...remoteSessionDocumentParsers(agent),
    parse: (file, content, context) =>
      Promise.resolve(
        parseContent(file, content, context.hostPlatform.os, parserOptions(context), context.signal)
      )
  }
}

function jsonlSource(
  agent: AiVaultAgent,
  remoteHome: string,
  hostPlatform: RemoteHostPlatform,
  segments: readonly string[],
  parseContent: RemoteContentParser<RemoteSessionContent>,
  filePredicate?: (path: string) => boolean
): RemoteSessionSource {
  return {
    ...source(agent, remoteHome, hostPlatform, segments, ['.jsonl'], parseContent, filePredicate),
    parseLines: (file, lines, context) =>
      Promise.resolve(
        parseContent(file, lines, context.hostPlatform.os, parserOptions(context), context.signal)
      )
  }
}

function remoteOpenClawSources(
  remoteHome: string,
  hostPlatform: RemoteHostPlatform
): RemoteSessionSource[] {
  return ['.openclaw', '.clawdbot'].map((rootName) => ({
    ...jsonlSource(
      'openclaw',
      remoteHome,
      hostPlatform,
      [rootName, 'agents'],
      openClawParser,
      (path) => remotePathSegments(path).includes('sessions')
    ),
    directoryPredicate: openClawSessionDirectoryPredicate
  }))
}

function parserOptions(context: RemoteScannerContext): RemoteParserOptions {
  return {
    executionHostId: context.executionHostId,
    executionHostPlatform: context.hostPlatform.os
  }
}
