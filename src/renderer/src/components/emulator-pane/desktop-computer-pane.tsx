import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

type ComputerApp = { name: string; bundleId: string; pid: number }
type ComputerSnapshot = {
  screenshot: { data: string; width: number; height: number; scale: number } | null
  snapshot: { window: { title: string; index: number | null } }
}

export function DesktopComputerPane({ active }: { active: boolean }) {
  const [apps, setApps] = useState<ComputerApp[]>([])
  const [selectedApp, setSelectedApp] = useState('')
  const [snapshot, setSnapshot] = useState<ComputerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const mountedRef = useRef(true)

  const refreshApps = useCallback(async () => {
    try {
      const result = await callRuntimeRpc<{ apps: ComputerApp[] }>(
        { kind: 'local' },
        'computer.listApps',
        {}
      )
      if (!mountedRef.current) {
        return
      }
      setApps(result.apps)
      setSelectedApp((current) =>
        result.apps.some((app) => app.name === current) ? current : (result.apps[0]?.name ?? '')
      )
      setError(null)
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : 'Could not list apps')
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshApps()
    return () => {
      mountedRef.current = false
    }
  }, [refreshApps])

  useEffect(() => {
    if (!active || !selectedApp) {
      return
    }
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await callRuntimeRpc<ComputerSnapshot>(
          { kind: 'local' },
          'computer.getAppState',
          { app: selectedApp }
        )
        if (!cancelled) {
          setSnapshot(result)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Desktop stream disconnected')
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), 500)
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [active, selectedApp])

  const click = (event: MouseEvent<HTMLImageElement>) => {
    if (!snapshot?.screenshot) {
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * snapshot.screenshot.width
    const y = ((event.clientY - bounds.top) / bounds.height) * snapshot.screenshot.height
    void callRuntimeRpc({ kind: 'local' }, 'computer.click', {
      app: selectedApp,
      windowIndex: snapshot.snapshot.window.index ?? undefined,
      x,
      y,
      noScreenshot: true
    })
  }

  const typeText = () => {
    if (!text || !selectedApp) {
      return
    }
    void callRuntimeRpc({ kind: 'local' }, 'computer.typeText', {
      app: selectedApp,
      text,
      noScreenshot: true
    })
    setText('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Monitor className="size-4 text-primary" />
        <span className="font-medium">Computer Use</span>
        <div className="flex-1" />
        <Select value={selectedApp} onValueChange={setSelectedApp} disabled={apps.length === 0}>
          <SelectTrigger className="h-7 w-[220px] text-xs">
            <SelectValue placeholder="Choose a running app" />
          </SelectTrigger>
          <SelectContent>
            {apps.map((app) => (
              <SelectItem key={`${app.pid}:${app.name}`} value={app.name} className="text-xs">
                {app.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => void refreshApps()}
          aria-label="Refresh apps"
        >
          <RefreshCw />
        </Button>
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            typeText()
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-7 w-[180px] text-xs"
            placeholder="Type into app"
            aria-label="Text to type into the selected app"
          />
          <Button type="submit" size="xs" variant="secondary" disabled={!text || !selectedApp}>
            Send
          </Button>
        </form>
      </div>
      {error ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted p-4">
        {snapshot?.screenshot ? (
          <img
            src={`data:image/png;base64,${snapshot.screenshot.data}`}
            alt={snapshot.snapshot.window.title || selectedApp}
            className="max-h-full max-w-full cursor-crosshair border border-border bg-black object-contain shadow-lg"
            draggable={false}
            onClick={click}
          />
        ) : (
          <div className="max-w-sm text-center text-xs text-muted-foreground">
            {selectedApp
              ? 'Waiting for the desktop stream…'
              : 'Launch a desktop app, then refresh the app list.'}
          </div>
        )}
      </div>
    </div>
  )
}
