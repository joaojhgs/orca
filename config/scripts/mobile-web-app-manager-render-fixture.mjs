export const MANAGER_RENDER_HOST = {
  id: 'manager-render-host',
  name: 'Manager Controller',
  endpoint: 'ws://manager-render',
  lastConnected: 1
}
export const MANAGER_RENDER_OWNER = `orca:manager-pending:v1:${'a'.repeat(64)}`

// A native receipt double; real native persistence is covered by the bridge round-trip tests.
export function installManagerRenderReplies({ version, ownerKey }) {
  const channel = globalThis.orcaBridge
  const forward = channel.postMessage
  let receipt = null
  globalThis.__orcaManagerReceipts = []
  channel.postMessage = (json) => {
    const frame = JSON.parse(json)
    if (
      frame.type !== 'request' ||
      (!frame.method.startsWith('manager.') && frame.method !== 'native.manager.receipt')
    ) {
      forward(json)
      return
    }
    globalThis.__orcaRenderCheckRequests.push({ method: frame.method, params: frame.params })
    let result
    if (frame.method === 'native.manager.receipt') {
      const { operation } = frame.params
      globalThis.__orcaManagerReceipts.push(operation)
      if (operation === 'read') {
        result = { operation, ownerKey, receipt }
      } else {
        if (frame.params.ownerKey !== ownerKey) {
          throw new Error('Wrong native receipt owner')
        }
        receipt = operation === 'save' ? frame.params.request : null
        result = { operation, ownerKey, confirmed: true }
      }
    } else if (frame.method === 'manager.principalsList') {
      result = {
        principals: [
          {
            id: 'manager-a',
            label: 'Hermes worker',
            createdAt: 0,
            expiresAt: 9999999999999,
            actions: ['run:create'],
            state: 'active',
            consumerConnected: false
          }
        ],
        nextOffset: null
      }
    } else if (frame.method === 'manager.conversationsList') {
      result = {
        conversations: ['run-a', 'run-b'].map((runId) => ({
          runId,
          principalId: 'manager-a',
          objective: `Objective ${runId}`,
          scope: {
            runId,
            workspaceId: 'folder:project',
            executionHostId: 'ssh:worker',
            actor: 'manager'
          }
        })),
        nextOffset: null
      }
    } else if (frame.method === 'manager.conversationShow') {
      const { runId } = frame.params
      result = {
        run: { id: runId, objective: `Objective ${runId}` },
        principalId: 'manager-a',
        messages: [
          {
            id: `question-${runId}`,
            runId,
            sequence: 1,
            role: 'manager',
            kind: 'question',
            body: `Choose the safe approach for ${runId}.`,
            replyTo: null,
            createdAt: '2026-10-10T23:00:00Z'
          }
        ],
        nextSequence: 1,
        hasMore: false
      }
    } else if (frame.method === 'manager.conversationSend') {
      if (!receipt || receipt.requestId !== frame.params.requestId) {
        throw new Error('No native receipt before send')
      }
      result = { messageId: 'accepted-reply', accepted: true, delivery: 'queued' }
    } else {
      throw new Error(`Unexpected manager request ${frame.method}`)
    }
    queueMicrotask(() =>
      channel.onmessage?.({
        data: JSON.stringify({
          v: version,
          type: 'reply',
          id: frame.id,
          payload: { id: frame.id, ok: true, result }
        })
      })
    )
  }
}
