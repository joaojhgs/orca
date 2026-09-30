import type { ResourceHostSnapshot } from '../../../../shared/process-stats-types'
import { formatMemory } from './resource-usage-metrics'

export function ResourceHostSummary({
  hosts
}: {
  hosts: readonly ResourceHostSnapshot[]
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek max-h-48 overflow-y-auto border-b border-border px-3 py-2 text-xs">
      {hosts.map((snapshot) => (
        <div key={snapshot.id} className="space-y-1 py-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{snapshot.name}</span>
            <span className="text-muted-foreground">
              {snapshot.kind === 'ssh' ? 'SSH' : 'Local'}
            </span>
          </div>
          {snapshot.host ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              <span>
                RAM {formatMemory(snapshot.host.usedMemory)} /{' '}
                {formatMemory(snapshot.host.totalMemory)}
              </span>
              <span>{formatMemory(snapshot.host.availableMemory)} available</span>
              {snapshot.host.cpuUsagePercent !== undefined ? (
                <span>CPU {snapshot.host.cpuUsagePercent.toFixed(0)}%</span>
              ) : null}
              {snapshot.host.diskAvailable !== undefined ? (
                <span>Disk {formatMemory(snapshot.host.diskAvailable)} free</span>
              ) : null}
              {snapshot.kind === 'ssh' ? (
                <span>Managed sessions {formatMemory(snapshot.managedMemory)}</span>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {snapshot.error ?? 'Host resources unavailable'}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
