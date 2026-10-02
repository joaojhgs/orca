import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { UsageRow } from '../status-bar/UsageRosterPanel'
import { getUsageRosterRowState } from '../status-bar/usage-roster-row-state'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import type { ExecutionCredential } from '../../../../shared/execution-observer'
import { SearchableSetting } from './SearchableSetting'
import { useResetCountdownClock } from '@/hooks/useResetCountdownClock'

/** Reuse the footer's quota renderer, with the credential owners visible in settings. */
export function ExecutionAccountUsageRows({
  provider
}: {
  provider?: ExecutionCredential['provider']
}): React.JSX.Element | null {
  const accounts = useAppStore((state) => state.rateLimits.executionAccounts)
  const display = normalizeUsagePercentageDisplay(
    useAppStore((state) => state.usagePercentageDisplay)
  )
  const rows = accounts?.filter((account) => !provider || account.provider === provider) ?? []
  const now = useResetCountdownClock(
    rows.flatMap((account) => [
      account.rateLimits?.session?.resetsAt,
      account.rateLimits?.weekly?.resetsAt,
      account.rateLimits?.monthly?.resetsAt,
      ...(account.rateLimits?.buckets?.map((bucket) => bucket.resetsAt) ?? [])
    ])
  )
  if (!rows.length) {
    return null
  }
  return (
    <SearchableSetting
      title={translate('settings.executionUsage.title', 'Usage across execution hosts')}
      description={translate(
        'settings.executionUsage.description',
        'Matching accounts share one quota reading. Credentials stay on their execution host.'
      )}
      keywords={[
        provider ?? 'providers',
        'usage',
        'quota',
        'ssh',
        'distrobox',
        'account',
        'rate limit'
      ]}
      className="flex flex-col gap-4"
    >
      {rows.map((account) => {
        const limits = account.rateLimits
        const hasUsage = Boolean(
          limits?.session || limits?.weekly || limits?.monthly || limits?.buckets?.length
        )
        return (
          <div
            key={account.id}
            data-execution-account={account.id}
            className="flex min-w-0 flex-col gap-2"
          >
            <p className="text-xs text-muted-foreground">
              {account.providerId ? `${account.providerId} · ` : ''}
              {account.sources.map((source) => source.label).join(' + ')}
              {account.sources.length > 1 && account.identityConfidence === 'account'
                ? ` · ${translate('settings.executionUsage.shared', 'same account')}`
                : ''}
              {account.identityConfidence === 'unknown'
                ? ` · ${translate('settings.executionUsage.unknownIdentity', 'account identity not verified')}`
                : ''}
            </p>
            {limits ? (
              <UsageRow
                p={limits}
                display={display}
                state={getUsageRosterRowState(limits, hasUsage)}
                showSignInAction={false}
                now={now}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate('settings.executionUsage.pending', 'Usage has not been verified yet')}
              </p>
            )}
            {account.error ? (
              <p className="text-xs text-muted-foreground">{account.error}</p>
            ) : null}
            {limits?.error ? <p className="text-xs text-muted-foreground">{limits.error}</p> : null}
          </div>
        )
      })}
    </SearchableSetting>
  )
}
