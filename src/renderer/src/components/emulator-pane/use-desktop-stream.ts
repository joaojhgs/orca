import { useEffect, useState, type RefObject } from 'react'
import { RFB, type VncClient } from '@/runtime/novnc-rfb'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

export type DesktopTarget = { id: string; label: string; viewOnly: boolean }
export const MAIN_DESKTOP: DesktopTarget = { id: 'main', label: 'Main desktop', viewOnly: false }
type DesktopStreamTicket = {
  path: string
  desktopId?: string
  viewOnly?: boolean
  credentials?: { password: string }
}

function bindDesktopStreamListeners(
  client: VncClient,
  listeners: [string, (event: Event) => void][]
): () => void {
  for (const [event, listener] of listeners) {
    client.addEventListener(event, listener)
  }
  return () => {
    for (const [event, listener] of listeners) {
      client.removeEventListener(event, listener)
    }
  }
}

export function useDesktopStream(
  targetRef: RefObject<HTMLDivElement | null>,
  desktop: DesktopTarget | null,
  active: boolean,
  attempt: number
) {
  const [state, setState] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const desktopId = desktop?.id
  const viewOnly = desktop?.viewOnly ?? true

  useEffect(() => {
    const target = targetRef.current
    if (!active || !target || !desktopId) {
      return
    }
    let cancelled = false
    let finished = false
    let rfb: VncClient | null = null
    let cleanupListeners = () => {}
    setState('connecting')
    setError(null)
    const fail = (message: string) => {
      if (cancelled || finished) {
        return
      }
      finished = true
      clearTimeout(timeout)
      cleanupListeners()
      rfb?.disconnect()
      setState('disconnected')
      setError(message)
    }
    const timeout = setTimeout(() => fail('Desktop stream timed out. Try reconnecting.'), 15_000)

    void (async () => {
      try {
        const ticket = await callRuntimeRpc<DesktopStreamTicket>(
          { kind: 'local' },
          'computer.desktopStreamTicket',
          desktopId === 'main' ? {} : { desktopId }
        )
        if (cancelled || finished) {
          return
        }
        // Older hosts ignore unknown parameters; never display the wrong desktop.
        if (
          (ticket.desktopId !== undefined && ticket.desktopId !== desktopId) ||
          (desktopId !== 'main' && (ticket.desktopId !== desktopId || ticket.viewOnly !== viewOnly))
        ) {
          throw new Error(
            'This server cannot select the requested desktop. Update Orca on the server.'
          )
        }
        if (!ticket.path.startsWith('/desktop-vnc?')) {
          throw new Error('Invalid desktop stream address')
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        rfb = new RFB(target, `${protocol}//${window.location.host}${ticket.path}`, {
          shared: true,
          ...(ticket.credentials ? { credentials: ticket.credentials } : {})
        })
        rfb.scaleViewport = true
        rfb.resizeSession = false
        rfb.viewOnly = viewOnly || ticket.viewOnly === true
        rfb.focusOnClick = !rfb.viewOnly
        rfb.background = 'rgb(0 0 0)'
        const listeners: [string, (event: Event) => void][] = [
          [
            'connect',
            () => {
              clearTimeout(timeout)
              if (!cancelled && !finished) {
                setState('connected')
                setError(null)
              }
            }
          ],
          ['disconnect', () => fail('Desktop stream disconnected. Try reconnecting.')],
          [
            'securityfailure',
            () =>
              fail('Desktop stream authorization failed. Check its server-side VNC credentials.')
          ],
          [
            'credentialsrequired',
            () =>
              fail(
                'This desktop requires VNC credentials. Configure its password file on the server.'
              )
          ]
        ]
        cleanupListeners = bindDesktopStreamListeners(rfb, listeners)
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : 'Could not open desktop stream')
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(timeout)
      cleanupListeners()
      rfb?.disconnect()
      target.replaceChildren()
    }
  }, [active, attempt, desktopId, targetRef, viewOnly])

  return { state: active && desktop ? state : 'disconnected', error }
}
