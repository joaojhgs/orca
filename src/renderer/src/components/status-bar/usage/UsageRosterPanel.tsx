import React from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SettingsSegmentedControl } from '@/components/settings/form-controls/SettingsFormControls'
import { useResetCountdownClock } from '@/components/status-bar/usage/useResetCountdownClock'
import { useTranslate } from '@/i18n/use-translate'
import type { ProviderRateLimits } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { UsagePercentageDisplay } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import { getProviderDisplayName } from '../../../../../shared/agent-usage/display/usage-provider-windows'
import { getUsageRosterRowState } from './usage-roster-row-state'
import type { StatusBarUsageMode } from '../../../../../shared/status-bar/status-bar-usage-mode'
import { providerPrimaryMaxUsed, usedSections } from './usage-headline-sections'
import { UsageDisplayToggle } from './usage-meter'
import { ExecutionUsageGroup } from '../ExecutionUsageGroup'
import type { ExecutionAccountUsage } from '../../../../../shared/execution-observer'
import { UsageRow } from './usage-roster-row'

export { UsageRow } from './usage-roster-row'

const NO_EXECUTION_ACCOUNTS: ExecutionAccountUsage[] = []
type ProviderId = ProviderRateLimits['provider']

/** Render one usage row per provider; hosts can wrap rows with account controls or detail menus. */
export function UsageRosterPanel({
  providers,
  executionAccounts = NO_EXECUTION_ACCOUNTS,
  display,
  statusBarUsageMode,
  onStatusBarUsageModeChange,
  isRefreshing,
  onRefresh,
  onOpenProvider,
  onSignIn,
  canSignIn,
  onManageAccounts,
  onUsageDetails,
  renderRow
}: {
  providers: ProviderRateLimits[]
  executionAccounts?: ExecutionAccountUsage[]
  display: UsagePercentageDisplay
  statusBarUsageMode: StatusBarUsageMode
  onStatusBarUsageModeChange: (mode: StatusBarUsageMode) => void
  isRefreshing: boolean
  onRefresh: () => void
  onOpenProvider: (provider: ProviderId) => void
  onSignIn: (provider: ProviderId) => void
  canSignIn: (provider: ProviderId) => boolean
  onManageAccounts: () => void
  onUsageDetails: () => void
  // Return null to use the default row instead of a host-supplied detail/account wrapper.
  renderRow?: (p: ProviderRateLimits, row: React.ReactNode) => React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  // Why: one boundary-scheduled clock keeps every open row current without per-provider timers.
  const now = useResetCountdownClock(
    [
      ...providers,
      ...executionAccounts.flatMap((account) => (account.rateLimits ? [account.rateLimits] : []))
    ].flatMap((provider) => usedSections(provider, t).map((section) => section.window.resetsAt))
  )
  // Why primary-only: a spent Fable/MCP window must not push a healthy provider to the top.
  const sorted = [...providers].sort(
    (a, b) => providerPrimaryMaxUsed(b, t) - providerPrimaryMaxUsed(a, t)
  )

  const openCodeAccounts = executionAccounts.filter((account) => account.provider === 'opencode')
  const renderExecutionRow = (account: ExecutionAccountUsage): React.ReactNode => {
    if (!account.rateLimits) {
      return null
    }
    return (
      <UsageRow
        p={account.rateLimits}
        label={account.providerId}
        display={display}
        state={getUsageRosterRowState(
          account.rateLimits,
          usedSections(account.rateLimits, t).length > 0,
          t
        )}
        showSignInAction={false}
        now={now}
        mode={statusBarUsageMode}
      />
    )
  }

  return (
    <div className="@container w-full text-xs">
      <div className="flex items-center justify-between gap-2 pb-2 pl-3.5 pr-[30px] pt-3">
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="text-[13px] font-semibold text-foreground">
            {t('auto.components.status.bar.UsageRosterPanel.title', 'Usage')}
          </span>
          <span className="truncate text-[11px]">
            · {t('auto.components.status.bar.UsageRosterPanel.allAgents', 'all agents')}
          </span>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onRefresh()
            }}
            aria-label={t('auto.components.status.bar.StatusBar.3325d996cb', 'Refresh rate limits')}
            className="size-5 justify-center p-0"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </DropdownMenuItem>
        </div>
        <UsageDisplayToggle asMenuItem />
      </div>
      {/* Keep the density picker in the popover so both usage modes are discoverable. */}
      <div className="px-3.5 pb-2.5">
        <SettingsSegmentedControl<StatusBarUsageMode>
          value={statusBarUsageMode}
          onChange={onStatusBarUsageModeChange}
          ariaLabel={t(
            'auto.components.status.bar.UsageRosterPanel.footerDetailAria',
            'Usage footer detail'
          )}
          size="sm"
          equalWidth
          options={[
            {
              value: 'verbose',
              label: t('auto.components.status.bar.UsageRosterPanel.detailed', 'Detailed'),
              tooltip: t(
                'auto.components.status.bar.UsageRosterPanel.detailedTooltip',
                'Full usage with bars, labels, and percentages'
              )
            },
            {
              value: 'compact',
              label: t('auto.components.status.bar.UsageRosterPanel.compact', 'Compact'),
              tooltip: t(
                'auto.components.status.bar.UsageRosterPanel.compactTooltip',
                'Condensed usage: one summary per provider'
              )
            }
          ]}
        />
      </div>
      <div className="border-t border-border/70" />
      <DropdownMenuGroup>
        {sorted.map((p) => {
          const accounts = executionAccounts.filter((account) => account.provider === p.provider)
          const state = getUsageRosterRowState(p, usedSections(p, t).length > 0, t)
          const showSignInAction = state.kind === 'sign-in' && canSignIn(p.provider)
          const rowNode = (
            <UsageRow
              p={p}
              display={display}
              state={state}
              showSignInAction={showSignInAction}
              now={now}
              mode={statusBarUsageMode}
            />
          )
          const custom = showSignInAction ? null : renderRow?.(p, rowNode)
          return (
            <React.Fragment key={p.provider}>
              {custom ?? (
                <DropdownMenuItem
                  onSelect={() => (showSignInAction ? onSignIn : onOpenProvider)(p.provider)}
                  className="w-full cursor-pointer rounded-none px-3.5 py-2.5"
                >
                  {rowNode}
                </DropdownMenuItem>
              )}
              {accounts.length && p.provider !== 'opencode' ? (
                <ExecutionUsageGroup
                  accounts={accounts}
                  label={t('usage.executionProviderAccounts', '{{provider}} · {{count}} accounts', {
                    provider: getProviderDisplayName(p.provider),
                    count: accounts.length
                  })}
                  renderRow={renderExecutionRow}
                />
              ) : null}
            </React.Fragment>
          )
        })}
        {openCodeAccounts.length ? (
          <ExecutionUsageGroup
            accounts={openCodeAccounts}
            label={t('usage.executionOpenCodeProviders', 'OpenCode · {{count}} providers', {
              count: new Set(openCodeAccounts.map((account) => account.providerId)).size
            })}
            renderRow={renderExecutionRow}
          />
        ) : null}
      </DropdownMenuGroup>
      <div className="border-t border-border/70" />
      <DropdownMenuItem
        onSelect={onUsageDetails}
        className="w-full cursor-pointer justify-between rounded-none px-3.5 py-2.5 text-[13px] text-foreground"
      >
        {t('auto.components.status.bar.UsageRosterPanel.usageDetails', 'Usage details & history')}
        <ChevronRight size={14} className="text-muted-foreground" />
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={onManageAccounts}
        className="w-full cursor-pointer justify-between rounded-none px-3.5 py-2.5 text-[13px] text-foreground"
      >
        {t('auto.components.status.bar.StatusBar.75ded02687', 'Manage Accounts…')}
        <ChevronRight size={14} className="text-muted-foreground" />
      </DropdownMenuItem>
    </div>
  )
}
