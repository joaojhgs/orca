import type { AiVaultAgent } from '../../shared/ai-vault/contracts/ai-vault-types'
import { parseDevinSessionDocument } from './scanners/devin/session-scanner-devin-parser'
import { parseHermesSessionDocument } from './session-scanner-hermes-parser'
import {
  parseGeminiSessionDocument,
  parseGeminiJsonlSessionLines
} from './scanners/gemini/session-scanner-gemini-parsers'
import type { RemoteSessionSource } from './remote-session-scanner-types'

export function remoteSessionDocumentParsers(
  agent: AiVaultAgent
): Pick<RemoteSessionSource, 'parseLines' | 'parseDocument'> {
  const parse =
    agent === 'hermes'
      ? parseHermesSessionDocument
      : agent === 'devin'
        ? parseDevinSessionDocument
        : agent === 'gemini'
          ? parseGeminiSessionDocument
          : null
  if (!parse) {
    return {}
  }
  return {
    parseDocument: (file, bytes, context) =>
      parse(
        file,
        bytes,
        context.hostPlatform.os,
        {
          executionHostId: context.executionHostId,
          executionHostPlatform: context.hostPlatform.os
        },
        context.signal
      ),
    ...(agent === 'gemini'
      ? {
          parseLines: (file, lines, context) =>
            parseGeminiJsonlSessionLines({
              file,
              lines,
              platform: context.hostPlatform.os,
              options: {
                executionHostId: context.executionHostId,
                executionHostPlatform: context.hostPlatform.os
              }
            })
        }
      : {})
  }
}
