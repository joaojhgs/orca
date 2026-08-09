import { useCallback, useEffect, useRef, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RFB, type VncClient } from '@/runtime/novnc-rfb'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

type DesktopStreamTicket = { path: string }
type StreamState = 'connecting' | 'connected' | 'disconnected'

function bindRfbEvents(
  rfb: VncClient,
  onConnect: (event: Event) => void,
  onDisconnect: (event: Event) => void,
  onSecurityFailure: (event: Event) => void
): () => void {
  rfb.addEventListener('connect', onConnect)
  rfb.addEventListener('disconnect', onDisconnect)
  rfb.addEventListener('securityfailure', onSecurityFailure)
  return () => {
    rfb.removeEventListener('connect', onConnect)
    rfb.removeEventListener('disconnect', onDisconnect)
    rfb.removeEventListener('securityfailure', onSecurityFailure)
  }
}

export function DesktopComputerPane({ active }: { active: boolean }) {
  const targetRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<VncClient | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<StreamState>('disconnected')
  const [error, setError] = useState<string | null>(null)

  const reconnect = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    const target = targetRef.current
    if (!active || !target) {
      return
    }
    let cancelled = false
    let rfb: VncClient | null = null
    setState('connecting')
    setError(null)

    const connect = async () => {
      try {
        const { path } = await callRuntimeRpc<DesktopStreamTicket>(
          { kind: 'local' },
          'computer.desktopStreamTicket',
          {}
        )
        if (cancelled) {
          return
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        rfb = new RFB(target, `${protocol}//${window.location.host}${path}`, {
          shared: true
        })
        rfb.scaleViewport = true
        rfb.resizeSession = false
        rfb.viewOnly = false
        rfb.focusOnClick = true
        rfb.background = 'rgb(0 0 0)'
        const onConnect = () => {
          setState('connected')
          setError(null)
        }
        const onDisconnect = (event: Event) => {
          setState('disconnected')
          const detail = (event as CustomEvent<{ clean?: boolean }>).detail
          if (!cancelled && detail?.clean !== true) {
            setError('Desktop stream disconnected')
          }
        }
        const onSecurityFailure = () => {
          setError('Desktop stream authorization failed')
        }
        cleanupListeners = bindRfbEvents(rfb, onConnect, onDisconnect, onSecurityFailure)
        rfbRef.current = rfb
      } catch (cause) {
        if (!cancelled) {
          setState('disconnected')
          setError(cause instanceof Error ? cause.message : 'Could not open desktop stream')
        }
      }
    }
    let cleanupListeners = () => {}
    void connect()

    return () => {
      cancelled = true
      cleanupListeners()
      rfb?.disconnect()
      if (rfbRef.current === rfb) {
        rfbRef.current = null
      }
      target.replaceChildren()
    }
  }, [active, attempt])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Monitor className="size-4 text-primary" />
        <span className="font-medium">Desktop</span>
        <span className="text-xs text-muted-foreground">
          {state === 'connected'
            ? 'Interactive'
            : state === 'connecting'
              ? 'Connecting…'
              : 'Offline'}
        </span>
        <div className="flex-1" />
        <Button size="icon-xs" variant="ghost" onClick={reconnect} aria-label="Reconnect desktop">
          <RefreshCw />
        </Button>
      </div>
      {error ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-black">
        <div
          ref={targetRef}
          className="size-full overflow-hidden [&_canvas]:mx-auto"
          tabIndex={0}
        />
      </div>
    </div>
  )
}
