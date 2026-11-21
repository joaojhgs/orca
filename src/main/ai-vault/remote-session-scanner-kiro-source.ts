import { kiroTranscriptPathForMetadata } from '../../shared/ai-vault/session-display/ai-vault-session-log-resource'
import type { RemoteHostPlatform } from '../ssh/remote-host/ssh-remote-platform'
import { joinRemotePath } from '../ssh/remote-host/ssh-remote-platform'
import { throwIfAiVaultScanCancelled } from './scan-lifecycle/ai-vault-scan-cancellation'
import { isMissingRemoteSessionPathError } from './transcripts/remote-session-file-stat'
import {
  remoteSessionContentLines,
  streamedSessionContentLines
} from './transcripts/remote-session-content-lines'
import type { RemoteScannerContext, RemoteSessionSource } from './remote-session-scanner-types'
import {
  isKiroSessionMetadataPath,
  parseKiroSessionContent
} from './scanners/kiro/session-scanner-kiro-parser'

async function readTranscriptLines(
  metadataPath: string,
  context: RemoteScannerContext
): Promise<Iterable<string> | AsyncIterable<string> | null> {
  const transcriptPath = kiroTranscriptPathForMetadata(metadataPath)
  // Why: beside the execution host the transcript streams; megabyte tool outputs are common.
  if (context.provider.readTranscriptBytes) {
    return streamedSessionContentLines(
      context.provider.readTranscriptBytes(transcriptPath, context.signal),
      context.signal
    )
  }
  try {
    throwIfAiVaultScanCancelled(context.signal)
    const read = await context.provider.readFile(transcriptPath)
    throwIfAiVaultScanCancelled(context.signal)
    return read.isBinary ? null : remoteSessionContentLines(read.content, context.signal)
  } catch (error) {
    throwIfAiVaultScanCancelled(context.signal)
    if (isMissingRemoteSessionPathError(error)) {
      return null
    }
    throw error
  }
}

export function remoteKiroSource(
  remoteHome: string,
  hostPlatform: RemoteHostPlatform,
  kiroHomeDir?: string
): RemoteSessionSource {
  return {
    agent: 'kiro',
    rootDir: kiroHomeDir
      ? joinRemotePath(hostPlatform, kiroHomeDir, 'sessions', 'cli')
      : joinRemotePath(hostPlatform, remoteHome, '.kiro', 'sessions', 'cli'),
    extensions: ['.json'],
    filePredicate: isKiroSessionMetadataPath,
    contentDependencyPath: kiroTranscriptPathForMetadata,
    directoryPredicate: () => false,
    parse: async (file, content, context) => {
      const options = {
        executionHostId: context.executionHostId,
        executionHostPlatform: context.hostPlatform.os
      }
      try {
        const lines = await readTranscriptLines(file.path, context)
        return await parseKiroSessionContent(file, content, lines, context.hostPlatform.os, options)
      } catch (error) {
        // A transcript that vanished mid-stream leaves a valid metadata-only session.
        if (!isMissingRemoteSessionPathError(error)) {
          throw error
        }
        return parseKiroSessionContent(file, content, null, context.hostPlatform.os, options)
      }
    }
  }
}
