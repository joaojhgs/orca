import { useEffect, useRef, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HostCombobox } from '@/components/host-picker/HostCombobox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { callRuntimeRpc, hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import { MAIN_DESKTOP, useDesktopStream, type DesktopTarget } from './use-desktop-stream'
import { useTranslate } from '@/i18n/use-translate'

export function DesktopComputerPane({ active }: { active: boolean }) {
  const t = useTranslate()
  const targetRef = useRef<HTMLDivElement>(null)
  const [desktopId, setDesktopId] = useState('main')
  const [targets, setTargets] = useState<DesktopTarget[]>([])
  const [targetsError, setTargetsError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [changingControl, setChangingControl] = useState(false)
  const initialized = useRef(false)
  const desktop = targets.find((target) => target.id === desktopId) ?? null
  const { state, error } = useDesktopStream(targetRef, desktop, active, attempt)

  useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    setTargetsError(null)
    void callRuntimeRpc<{ capabilities?: string[] }>({ kind: 'local' }, 'status.get', {})
      .then((status) =>
        callRuntimeRpc<{ targets: DesktopTarget[] }>(
          { kind: 'local' },
          'computer.desktopTargets',
          status.capabilities?.includes('computer.execution-hosts.v1')
            ? { executionHosts: true }
            : {}
        )
      )
      .then(({ targets: nextTargets }) => {
        if (!cancelled) {
          setTargets(nextTargets)
          if (!initialized.current && nextTargets.length > 0) {
            initialized.current = true
            setDesktopId(
              nextTargets.find((target) => target.id === 'main')?.id ?? nextTargets[0].id
            )
          }
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
    (targets.length === 0 && !targetsError
      ? 'No approved desktops are reachable. Connect their SSH host, then reconnect.'
      : targets.length > 0 && !desktop
        ? 'The selected desktop is no longer configured. Choose another desktop.'
        : null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Monitor className="size-4 text-muted-foreground" />
        <HostCombobox
          value={desktopId}
          onChange={setDesktopId}
          options={targets}
          disabled={targets.length === 0}
          size="sm"
          className="w-48"
          ariaLabel={t(
            'auto.components.emulator.pane.desktop.computer.pane.70e6104eda',
            'Desktop view'
          )}
          placeholder={t(
            'auto.components.emulator.pane.desktop.computer.pane.ffefb85f5b',
            'Choose desktop'
          )}
        />
        <span className="w-24 text-xs text-muted-foreground" role="status" aria-live="polite">
          {state === 'connected'
            ? desktop?.viewOnly
              ? t('auto.components.emulator.pane.desktop.computer.pane.0d34e118f7', 'View only')
              : t('auto.components.emulator.pane.desktop.computer.pane.4f5c7aad69', 'Interactive')
            : state === 'connecting'
              ? t('auto.components.emulator.pane.desktop.computer.pane.d12e10db72', 'Connecting…')
              : t('auto.components.emulator.pane.desktop.computer.pane.c91a960a27', 'Offline')}
        </span>
        <div className="flex-1" />
        {desktop?.browserId ? (
          <Button
            size="xs"
            variant={desktop.humanControl ? 'secondary' : 'outline'}
            disabled={changingControl}
            onClick={() => {
              const browserId = desktop.browserId
              if (!browserId) {
                return
              }
              setChangingControl(true)
              void callRuntimeRpc<{ humanControl: boolean }>(
                { kind: 'local' },
                'computer.browserControl',
                { browserId, humanControl: !desktop.humanControl }
              )
                .then((result) =>
                  setTargets((rows) =>
                    rows.map((row) =>
                      row.browserId === browserId
                        ? { ...row, humanControl: result.humanControl }
                        : row
                    )
                  )
                )
                .catch(() =>
                  setTargetsError('Could not change browser control. Check the host connection.')
                )
                .finally(() => setChangingControl(false))
            }}
          >
            {desktop.humanControl
              ? t(
                  'auto.components.emulator.pane.desktop.computer.pane.228bc8b4a7',
                  'Return to agents'
                )
              : t(
                  'auto.components.emulator.pane.desktop.computer.pane.59073f7ee0',
                  'Take browser control'
                )}
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setAttempt((value) => value + 1)}
              aria-label={t(
                'auto.components.emulator.pane.desktop.computer.pane.22de1b2e98',
                'Reconnect desktop'
              )}
            >
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t(
              'auto.components.emulator.pane.desktop.computer.pane.22de1b2e98',
              'Reconnect desktop'
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      {desktop?.browserId ? (
        <div
          className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {desktop.humanControl
            ? t(
                'auto.components.emulator.pane.desktop.computer.pane.e19a319c27',
                'You control this browser. Agent CDP connections are paused.'
              )
            : t(
                'auto.components.emulator.pane.desktop.computer.pane.daee142e1d',
                'CDP browser. Take control to pause agents before interacting.'
              )}
        </div>
      ) : null}
      {desktop?.viewOnly ? (
        <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          {t(
            'auto.components.emulator.pane.desktop.computer.pane.6ecbe9c3a8',
            'View only. Agent computer use stays on the main desktop.'
          )}
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
