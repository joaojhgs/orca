import type { VncAgentAction } from '../../shared/vnc-agent-contract'
import { resolveDesktopVncAccess } from './desktop-vnc-inventory'
import { isDesktopVncTicketCurrent, openDesktopVncRoute } from './ssh-desktop-vnc-route'
import { VncAgentReader } from './vnc-agent-reader'
import { initializeVncAgent } from './vnc-agent-handshake'
import { captureVncAgentFramebuffer } from './vnc-agent-framebuffer'
import { sendVncAgentInput } from './vnc-agent-input'

let inFlight = false

async function resolveAccessWithinDeadline(desktopId: string, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<Awaited<ReturnType<typeof resolveDesktopVncAccess>>>((resolve, reject) => {
    const canceled = () =>
      reject(new Error('Desktop device authority resolution canceled or timed out'))
    signal.addEventListener('abort', canceled, { once: true })
    void resolveDesktopVncAccess(desktopId).then(
      (access) => {
        signal.removeEventListener('abort', canceled)
        resolve(access)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', canceled)
        reject(error)
      }
    )
  })
}

export async function performVncAgentAction(
  desktopId: string,
  action: VncAgentAction,
  signal?: AbortSignal
) {
  if (inFlight) {
    throw new Error('Desktop device proxy is busy; retry after the current request finishes')
  }
  inFlight = true
  const abort = new AbortController()
  let channel: Awaited<ReturnType<typeof openDesktopVncRoute>> | undefined
  let reader: VncAgentReader | undefined
  const stop = () => {
    abort.abort()
    reader?.fail(new Error('Desktop device request canceled; input effects are unverifiable'))
    channel?.socket.destroy()
  }
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted) {
    stop()
  }
  const timer = setTimeout(() => {
    abort.abort()
    reader?.fail(new Error('Desktop device request timed out; input effects are unverifiable'))
    channel?.socket.destroy()
  }, 60000)
  try {
    const { target, password } = await resolveAccessWithinDeadline(desktopId, abort.signal)
    if (action.kind !== 'screenshot' && target.viewOnly) {
      throw new Error('Input is disabled for this desktop')
    }
    const assertAuthority = () => {
      if (abort.signal.aborted || !isDesktopVncTicketCurrent(target)) {
        throw new Error('Desktop device authority expired; reconnect and rediscover its host')
      }
    }
    assertAuthority()
    channel = await openDesktopVncRoute(target, abort.signal)
    assertAuthority()
    reader = new VncAgentReader(channel.socket)
    void channel.whenInvalidated?.then(() => {
      reader?.fail(new Error('Desktop device authority expired'))
      channel?.socket.destroy()
    })
    const check = setInterval(() => {
      try {
        assertAuthority()
      } catch {
        reader?.fail(new Error('Desktop device authority expired'))
        channel?.socket.destroy()
      }
    }, 250)
    try {
      const geometry = await initializeVncAgent(reader, password)
      assertAuthority()
      if (action.kind === 'screenshot') {
        const screenshot = await captureVncAgentFramebuffer(reader, geometry.width, geometry.height)
        assertAuthority()
        return { desktopId, viewOnly: target.viewOnly, ...screenshot }
      }
      await sendVncAgentInput(reader, action, geometry.width, geometry.height)
      assertAuthority()
      return { desktopId, ...geometry, delivered: true, verification: 'unverified' as const }
    } finally {
      clearInterval(check)
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
    abort.abort()
    channel?.socket.destroy()
    inFlight = false
    await channel?.close()
  }
}
