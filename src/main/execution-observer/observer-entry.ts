import { executionObserverRequestSchema } from '../../shared/execution-observer'
import { discoverExecutionCredentials } from './credential-discovery'
import { collectExecutionUsage } from './usage-collector'
import { scanWorkspacePorts } from '../ports/local-workspace-port-scanner'
import { observeSkillLibrary } from './skill-library-worker'

async function main() {
  const encoded = process.env.ORCA_OBSERVER_REQUEST
  if (!encoded || encoded.length > 2 * 1024 * 1024) {
    throw new Error('Invalid observer request')
  }
  const request = executionObserverRequestSchema.parse(
    JSON.parse(Buffer.from(encoded, 'base64').toString())
  )
  if (request.operation === 'discover') {
    return discoverExecutionCredentials()
  }
  if (request.operation === 'usage') {
    return collectExecutionUsage(request.credential)
  }
  if (
    request.operation === 'library-discover' ||
    request.operation === 'library-package' ||
    request.operation === 'library-cleanup' ||
    request.operation === 'library-stage' ||
    request.operation === 'library-install' ||
    request.operation === 'library-remove'
  ) {
    return observeSkillLibrary(request)
  }
  // Why: non-Linux command scanning needs the host's bundled worker, not a host-side fallback.
  if (process.platform !== 'linux') {
    return {
      platform: process.platform,
      scannedAt: Date.now(),
      ports: [],
      unavailableReason: 'Standalone port discovery currently requires Linux'
    }
  }
  return scanWorkspacePorts(
    request.workspaces,
    { lookup: () => undefined, reconcileScan: () => {} },
    { requireMetadata: true }
  )
}

void main().then(
  (value) => {
    process.stdout.write(`ORCA_OBSERVER_RESULT:${JSON.stringify(value)}\n`)
  },
  () => {
    // Why: third-party errors can contain credential material; never serialize them.
    process.stdout.write(
      'ORCA_OBSERVER_RESULT:{"observerError":"Execution-host observation failed"}\n'
    )
    process.exitCode = 1
  }
)
