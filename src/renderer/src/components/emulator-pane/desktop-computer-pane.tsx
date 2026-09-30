import { useEffect, useRef, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { callRuntimeRpc, hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import { MAIN_DESKTOP, useDesktopStream, type DesktopTarget } from './use-desktop-stream'

export function DesktopComputerPane({ active }: { active: boolean }) {
  const targetRef = useRef<HTMLDivElement>(null)
  const [desktopId, setDesktopId] = useState('main')
  const [targets, setTargets] = useState<DesktopTarget[]>([])
  const [targetsError, setTargetsError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const desktop = targets.find((target) => target.id === desktopId) ?? null
  const { state, error } = useDesktopStream(targetRef, desktop, active, attempt)

  useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    setTargetsError(null)
    void callRuntimeRpc<{ targets: DesktopTarget[] }>(
      { kind: 'local' },
      'computer.desktopTargets',
      {}
    )
      .then(({ targets: nextTargets }) => {
        if (!cancelled) {
          setTargets(nextTargets)
        }
      })
      .catch((cause) => {
        if (cancelled) {
          return
        }
        if (hasRuntimeRpcErrorCode(cause, 'method_not_found')) {
          setTargets([MAIN_DESKTOP])
        } else {
          setTargets([])
          setTargetsError('Could not load desktops. Check the server configuration and reconnect.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [active, attempt])

  const displayedError =
    targetsError ??
    error ??
    (targets.length > 0 && !desktop
      ? 'The selected desktop is no longer configured. Choose another desktop.'
      : null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Monitor className="size-4 text-muted-foreground" />
        <Select value={desktopId} onValueChange={setDesktopId} disabled={targets.length === 0}>
          <SelectTrigger size="sm" className="w-48" aria-label="Desktop view">
            <SelectValue placeholder="Choose desktop" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {targets.map((target) => (
                <SelectItem key={target.id} value={target.id}>
                  {target.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="w-24 text-xs text-muted-foreground" role="status" aria-live="polite">
          {state === 'connected'
            ? desktop?.viewOnly
              ? 'View only'
              : 'Interactive'
            : state === 'connecting'
              ? 'Connecting…'
              : 'Offline'}
        </span>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setAttempt((value) => value + 1)}
              aria-label="Reconnect desktop"
            >
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reconnect desktop</TooltipContent>
        </Tooltip>
      </div>
      {desktop?.viewOnly ? (
        <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          View only. Agent computer use stays on the main desktop.
        </div>
      ) : null}
      {displayedError ? (
        <div
          role="alert"
          className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {displayedError}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-black">
        <div
          ref={targetRef}
          className="size-full overflow-hidden [&_canvas]:mx-auto"
          tabIndex={desktop?.viewOnly ? -1 : 0}
        />
      </div>
    </div>
  )
}
