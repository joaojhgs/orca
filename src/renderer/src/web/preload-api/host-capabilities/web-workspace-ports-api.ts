import type { PreloadApi } from '../../../../../preload/api-types'
import { noopUnsubscribe } from '../web-storage'
import { callRuntimeResult } from '../../runtime/client/web-runtime-calls'

export function createWebWorkspacePortsApi(): Partial<PreloadApi> {
  return {
    workspacePorts: {
      scan: (args) => callRuntimeResult('workspacePorts.scan', args, 60_000),
      kill: (args) => callRuntimeResult('workspacePorts.kill', args, 60_000),
      probePage: () => Promise.resolve({ kind: 'not-page' }),
      onAdvertisedUrlChanged: () => noopUnsubscribe
    }
  }
}
