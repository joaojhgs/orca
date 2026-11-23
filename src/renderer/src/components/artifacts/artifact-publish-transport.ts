import type {
  ArtifactCloudOperation,
  ArtifactPublishResult,
  ArtifactWriteRequest
} from '../../../../shared/artifacts/artifacts'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { bytesToBase64 } from '@/runtime/files/reads/runtime-paged-file-read'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'

const target = { kind: 'local' } as const

export async function sendArtifactPublish(
  request: ArtifactWriteRequest
): Promise<ArtifactCloudOperation<ArtifactPublishResult>> {
  const bytes = new TextEncoder().encode(JSON.stringify(request))
  if (bytes.length <= 700 * 1024) {
    return callRuntimeRpc(target, 'artifacts.publish', request)
  }
  let uploadId: string
  try {
    ;({ uploadId } = await callRuntimeRpc<{ uploadId: string }>(target, 'artifacts.uploadStart', {
      totalBytes: bytes.length
    }))
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      throw new Error('Update Orca server to share artifacts larger than 700 KiB')
    }
    throw error
  }
  try {
    for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
      await callRuntimeRpc(target, 'artifacts.uploadAppend', {
        uploadId,
        offset,
        contentBase64: bytesToBase64(bytes.subarray(offset, offset + 192 * 1024))
      })
    }
    return await callRuntimeRpc(
      target,
      'artifacts.uploadCommit',
      { uploadId },
      { timeoutMs: 120_000 }
    )
  } catch (error) {
    void callRuntimeRpc(target, 'artifacts.uploadAbort', { uploadId }).catch(() => {})
    throw error
  }
}
