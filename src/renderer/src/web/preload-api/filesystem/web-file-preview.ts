import { filePreviewForPath } from '../../../../../shared/file-preview/file-preview-kind'
import type { PreloadApi } from '../../../../../preload/api-types'
import {
  remoteFilePath,
  remoteFileRequest
} from '../../../../../shared/file-access/remote-file-locator'
import { callRuntimeRpc } from '../../../runtime/rpc/calls/runtime-rpc-call'
import { resolveEnvironment } from '../../runtime/client/web-runtime-session'
import { RuntimeRpcCallError } from '../../../runtime/rpc/calls/runtime-rpc-result'

type PreviewAddress = Parameters<PreloadApi['fs']['grantRuntimeFilePreview']>[0]
type WebPreview = NonNullable<Awaited<ReturnType<PreloadApi['fs']['grantRuntimeFilePreview']>>>
const urls = new Set<string>()

export async function grantWebFilePreview(address: PreviewAddress): Promise<WebPreview | null> {
  if (filePreviewForPath(remoteFilePath(address))?.kind === 'image') {
    return null
  }
  const environment = resolveEnvironment(address.environmentId)
  const endpoint =
    environment.endpoints.find((entry) => entry.id === environment.preferredEndpointId) ??
    environment.endpoints[0]
  if (!endpoint) {
    throw new Error('No preview endpoint is available')
  }
  const { params } = remoteFileRequest(address.worktree, address, 'stat')
  try {
    const preview = await callRuntimeRpc<WebPreview>(
      { kind: 'environment', environmentId: environment.id },
      'files.previewUrl',
      params,
      { expectedEnvironmentPairingRevision: address.expectedEnvironmentPairingRevision }
    )
    if (!preview.mediaUrl || !/^\/__orca_media\/[\w-]{43}$/.test(preview.mediaUrl)) {
      throw new Error('Invalid preview URL')
    }
    const origin = new URL(endpoint.endpoint)
    origin.protocol = origin.protocol === 'wss:' ? 'https:' : 'http:'
    preview.mediaUrl = new URL(preview.mediaUrl, origin).href
    if (urls.size >= 256) {
      urls.delete(urls.values().next().value!)
    }
    urls.add(preview.mediaUrl)
    return preview
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return null
    }
    throw error
  }
}

export async function grantWebFilePreviewForFile(address: {
  worktree: string
  relativePath: string
  environmentId: string
  expectedEnvironmentPairingRevision: number
}): Promise<WebPreview> {
  const preview = await grantWebFilePreview(address)
  if (!preview) {
    throw new Error('Update Orca server to preview media in the browser')
  }
  return preview
}

export async function readWebPreviewRange({
  url,
  offset,
  length
}: Parameters<PreloadApi['fs']['readPreviewRange']>[0]): Promise<Uint8Array> {
  if (
    !urls.has(url) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 4 * 1024 * 1024
  ) {
    throw new Error('Invalid preview range')
  }
  const response = await fetch(url, {
    headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  })
  if (response.status !== 206) {
    throw new Error('Preview range is unavailable; reopen the file')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > length) {
    throw new Error('Invalid preview range response')
  }
  return bytes
}
