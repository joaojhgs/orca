import { createHash } from 'node:crypto'
import type { ExecutionCredential, ExecutionAccountUsage } from '../../shared/execution-observer'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'

export type UsageExecutionHost = {
  id: string
  label: string
  generation: number
  reachable: boolean
  discover: () => Promise<ExecutionCredential[]>
  collect: (credential: ExecutionCredential) => Promise<ProviderRateLimits>
}
type HostInventory = { generation: number; credentials: ExecutionCredential[]; reachable: boolean }
const POLL_MS = 5 * 60_000

export function executionAccountUsageId(
  host: Pick<UsageExecutionHost, 'id' | 'generation'>,
  credential: ExecutionCredential
): string {
  const identity =
    credential.identityConfidence === 'account' && credential.accountKey
      ? ['account', credential.provider, credential.providerId, credential.accountKey]
      : [
          'unverified',
          host.id,
          host.generation,
          credential.provider,
          credential.sourceRef,
          credential.credentialRevision
        ]
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

/** One account quota cache across execution hosts, not one provider poll per terminal. */
export class ExecutionAccountUsageService {
  private inventories = new Map<string, HostInventory>()
  private rows: ExecutionAccountUsage[] = []
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private lastDiscoveryAt = 0
  private preferredOwners = new Map<string, string>()
  constructor(
    private readonly getHosts: () => UsageExecutionHost[],
    private readonly onChanged: () => void,
    private readonly now = Date.now
  ) {}

  getState(): ExecutionAccountUsage[] {
    return this.rows
  }
  start(): void {
    this.stopped = false
    this.timer ??= setInterval(() => {
      void this.refresh().catch(() => console.warn('[execution-usage] Observation cycle failed'))
    }, 30_000)
    this.timer.unref()
    void this.refresh().catch(() => console.warn('[execution-usage] Observation cycle failed'))
  }
  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = null
  }
  refresh(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }
    if (this.inFlight) {
      return this.inFlight
    }
    if (this.lastDiscoveryAt && this.now() - this.lastDiscoveryAt < 30_000) {
      return Promise.resolve()
    }
    this.inFlight = this.runCycle().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }
  private async runCycle(): Promise<void> {
    const hosts = this.getHosts().slice(0, 64)
    this.lastDiscoveryAt = this.now()
    const currentIds = new Set(hosts.map((host) => host.id))
    for (const id of this.inventories.keys()) {
      if (!currentIds.has(id)) {
        this.inventories.delete(id)
      }
    }
    for (const host of hosts) {
      if (this.stopped) {
        return
      }
      let previous = this.inventories.get(host.id)
      if (previous?.generation !== host.generation) {
        previous = undefined
      }
      if (!host.reachable) {
        this.inventories.set(host.id, {
          generation: host.generation,
          credentials: previous?.credentials ?? [],
          reachable: false
        })
        continue
      }
      try {
        const credentials = await host.discover()
        this.inventories.set(host.id, { generation: host.generation, credentials, reachable: true })
      } catch {
        this.inventories.set(host.id, {
          generation: host.generation,
          credentials: previous?.credentials ?? [],
          reachable: false
        })
      }
    }
    const previousRows = new Map(this.rows.map((row) => [row.id, row]))
    const groups = new Map<
      string,
      { credential: ExecutionCredential; hosts: UsageExecutionHost[] }
    >()
    for (const host of hosts) {
      for (const credential of this.inventories.get(host.id)?.credentials ?? []) {
        const id = executionAccountUsageId(host, credential)
        const group = groups.get(id)
        if (group) {
          group.hosts.push(host)
        } else {
          groups.set(id, { credential, hosts: [host] })
        }
      }
    }
    const next: ExecutionAccountUsage[] = []
    for (const id of this.preferredOwners.keys()) {
      if (!groups.has(id)) {
        this.preferredOwners.delete(id)
      }
    }
    for (const [id, group] of groups) {
      if (this.stopped) {
        return
      }
      const previous = previousRows.get(id)
      const row: ExecutionAccountUsage = {
        ...group.credential,
        id,
        sources: group.hosts.map((host) => {
          const credential = this.inventories
            .get(host.id)
            ?.credentials.find((candidate) => executionAccountUsageId(host, candidate) === id)
          return {
            executionHostId: host.id,
            label: host.label,
            sourceRef: credential?.sourceRef ?? group.credential.sourceRef,
            credentialRevision: credential?.credentialRevision,
            reachable: this.inventories.get(host.id)?.reachable === true
          }
        }),
        rateLimits: previous?.rateLimits ?? null,
        checkedAt: previous?.checkedAt ?? 0,
        retryAt: previous?.retryAt ?? 0
      }
      const owner = group.hosts.find((host) => this.inventories.get(host.id)?.reachable)
      if (!owner) {
        row.error = 'Execution-host observation is unverifiable while disconnected'
      } else if (row.retryAt <= this.now()) {
        await this.collectRow(row, group.hosts)
      } else if (!row.rateLimits) {
        row.error = previous?.error
      }
      next.push(row)
    }
    if (this.stopped) {
      return
    }
    this.rows = next
    this.onChanged()
  }

  private async collectRow(row: ExecutionAccountUsage, hosts: UsageExecutionHost[]): Promise<void> {
    const owners = hosts.filter((host) => this.inventories.get(host.id)?.reachable)
    const preferred = this.preferredOwners.get(row.id)
    owners.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))
    // Why: try fresh credentials for the same verified account, but never bypass account-level throttling.
    for (const owner of owners.slice(0, 2)) {
      if (this.stopped) {
        return
      }
      row.retryAt = this.now() + POLL_MS
      try {
        const credential = this.inventories
          .get(owner.id)
          ?.credentials.find((candidate) => executionAccountUsageId(owner, candidate) === row.id)
        if (!credential) {
          throw new Error('Credential changed')
        }
        const limits = await owner.collect(credential)
        row.rateLimits = limits
        row.checkedAt = this.now()
        row.error = undefined
        row.retryAt = Math.max(row.retryAt, limits.usageMetadata?.retryAtMs ?? 0)
        if (limits.status === 'ok') {
          this.preferredOwners.set(row.id, owner.id)
          return
        }
        if (!['stale-token', 'network'].includes(limits.usageMetadata?.failureKind ?? '')) {
          return
        }
      } catch {
        row.error = 'Execution-host usage could not be verified'
        const source = row.sources.find((source) => source.executionHostId === owner.id)
        if (source) {
          source.reachable = false
        }
      }
    }
  }
}
