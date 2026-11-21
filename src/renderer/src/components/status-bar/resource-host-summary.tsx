import type { ResourceHostSnapshot } from '../../../../shared/diagnostics/process-stats-types'
import { HostListOverflowNote } from '../host-picker/HostListOverflowNote'
import { HostListSearchField } from '../host-picker/HostListSearchField'
import { useBoundedHostRows } from '../host-picker/use-bounded-host-rows'
import { formatMemory } from './resources/popover/resource-usage-metrics'
import { useTranslate } from '@/i18n/use-translate'

export function ResourceHostSummary({
  hosts
}: {
  hosts: readonly ResourceHostSnapshot[]
}): React.JSX.Element {
  const t = useTranslate()
  const rows = useBoundedHostRows(
    hosts.map((snapshot) => ({ id: snapshot.id, label: snapshot.name, snapshot }))
  )
  return (
    <div className="scrollbar-sleek max-h-48 overflow-y-auto border-b border-border px-3 py-2 text-xs">
      {rows.searchable && <HostListSearchField value={rows.query} onChange={rows.setQuery} />}
      {rows.shown.map(({ snapshot }) => (
        <div key={snapshot.id} className="space-y-1 py-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{snapshot.name}</span>
            <span className="text-muted-foreground">
              {snapshot.kind === 'ssh'
                ? t('auto.components.status.bar.resource.host.summary.71aa1dcb71', 'SSH')
                : t('auto.components.status.bar.resource.host.summary.82cdbe7350', 'Local')}
            </span>
          </div>
          {snapshot.host ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              <span>
                {t('auto.components.status.bar.resource.host.summary.a9e0fdbdb8', 'RAM')}{' '}
                {formatMemory(snapshot.host.usedMemory)} / {formatMemory(snapshot.host.totalMemory)}
              </span>
              <span>
                {formatMemory(snapshot.host.availableMemory)}{' '}
                {t('auto.components.status.bar.resource.host.summary.b0f0c7ab4d', 'available')}
              </span>
              {snapshot.host.cpuUsagePercent !== undefined ? (
                <span>
                  {t('auto.components.status.bar.resource.host.summary.de3af4f529', 'CPU')}{' '}
                  {snapshot.host.cpuUsagePercent.toFixed(0)}%
                </span>
              ) : null}
              {snapshot.host.diskAvailable !== undefined ? (
                <span>
                  {t('auto.components.status.bar.resource.host.summary.6a2c33f24f', 'Disk')}{' '}
                  {formatMemory(snapshot.host.diskAvailable)}{' '}
                  {t('auto.components.status.bar.resource.host.summary.7d8c724eec', 'free')}
                </span>
              ) : null}
              {snapshot.kind === 'ssh' ? (
                <span>
                  {t(
                    'auto.components.status.bar.resource.host.summary.d642e54440',
                    'Managed sessions'
                  )}{' '}
                  {formatMemory(snapshot.managedMemory)}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {snapshot.error ??
                t(
                  'auto.components.status.bar.resource.host.summary.49378c2cbc',
                  'Host resources unavailable'
                )}
            </div>
          )}
        </div>
      ))}
      <HostListOverflowNote hiddenCount={rows.hiddenCount} />
    </div>
  )
}
