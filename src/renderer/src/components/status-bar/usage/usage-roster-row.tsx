import { cn } from '@/lib/class-names'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import type { ProviderRateLimits } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { UsagePercentageDisplay } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import { ProviderIcon } from './provider-usage-panel'
import { getProviderDisplayName } from '../../../../../shared/agent-usage/display/usage-provider-windows'
import { formatPlanLabel } from './usage-roster-formatting'
import type { UsageRosterRowState } from './usage-roster-row-state'
import type { StatusBarUsageMode } from '../../../../../shared/status-bar/status-bar-usage-mode'
import {
  getTopScopedSection,
  getUrgentScopedSection,
  getUsageHeadlineSection,
  shortUsageLabel,
  usedSections,
  type UsageSection
} from './usage-headline-sections'
import {
  formatLocalizedResetDuration,
  formatResetsInCaption,
  soonestResetLabel,
  validResetAt
} from './usage-reset-caption'
import { formatBareUsagePercentage, formatUsagePercentageLabel } from './usage-percentage-label'
import { getUsageHealthTone } from './usage-health-tone'
import { UsageBar, UsageValue } from './usage-meter'

function DetailMetric({
  section,
  label,
  display,
  title
}: {
  section: UsageSection
  label: string
  display: UsagePercentageDisplay
  title?: string
}): React.JSX.Element {
  return (
    <span
      data-usage-window={section.label}
      title={title}
      className="flex shrink-0 items-center gap-1.5"
    >
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <UsageBar
        usedPercent={section.window.usedPercent}
        display={display}
        className="h-[5px] w-7"
      />
      <UsageValue
        usedPercent={section.window.usedPercent}
        display={display}
        className="text-[11px]"
      />
    </span>
  )
}

/** Spells out what a Fable figure limits; MCP windows are not weekly, so they get no title. */
function scopedUsageTitle(
  p: ProviderRateLimits,
  section: UsageSection,
  display: UsagePercentageDisplay,
  t: Translate
): string | undefined {
  if (section.window !== p.fableWeekly) {
    return undefined
  }
  return t(
    'auto.components.status.bar.UsageRosterPanel.modelWeeklyLimit',
    '{{model}} weekly limit: {{usage}}',
    {
      model: section.label,
      usage: formatUsagePercentageLabel(section.window.usedPercent, display, t)
    }
  )
}

function ScopedUsageFlag({
  p,
  section,
  display
}: {
  p: ProviderRateLimits
  section: UsageSection
  display: UsagePercentageDisplay
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <span
      data-usage-scoped-urgent
      title={scopedUsageTitle(p, section, display, t)}
      className="shrink-0 text-[11px] text-muted-foreground"
    >
      {`${section.label} ${formatBareUsagePercentage(section.window.usedPercent, display, t)}`}
    </span>
  )
}

function RowUsageSummary({
  p,
  display,
  now
}: {
  p: ProviderRateLimits
  display: UsagePercentageDisplay
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const headline = getUsageHeadlineSection(p, t)
  if (!headline) {
    // Why: a Fable/MCP-only reading is still a reading; show it where the value goes, at any level.
    const only = getTopScopedSection(p, t)
    return (
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {only ? (
          <span
            data-usage-scoped-only
            title={scopedUsageTitle(p, only, display, t)}
            className="text-right text-[12px] font-medium tabular-nums"
          >
            <span className="text-[11px] font-normal text-muted-foreground">{only.label}</span>{' '}
            {formatBareUsagePercentage(only.window.usedPercent, display, t)}
          </span>
        ) : (
          <span data-usage-not-checked className="text-[11px] text-muted-foreground">
            {t('auto.components.status.bar.UsageRosterPanel.notChecked', 'Not checked')}
          </span>
        )}
      </span>
    )
  }
  const scoped = getUrgentScopedSection(p, t)
  // Why: a nearly spent headline needs its own reset more than a scoped flag the Detailed line repeats.
  const showScoped = scoped !== null && getUsageHealthTone(headline.window.usedPercent) !== 'urgent'
  const resetsAt = validResetAt(headline.window.resetsAt)
  const resetLabel =
    resetsAt === null
      ? null
      : (formatLocalizedResetDuration(resetsAt, now, intlLocale) ??
        t('auto.components.status.bar.InlineUsageBars.now', 'now'))
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      {showScoped && scoped ? (
        <ScopedUsageFlag p={p} section={scoped} display={display} />
      ) : resetLabel ? (
        <span
          data-usage-reset
          aria-label={formatResetsInCaption(resetsAt, now, intlLocale, t) ?? undefined}
          className="text-[11px] text-muted-foreground @max-[340px]:hidden"
        >
          {resetLabel}
        </span>
      ) : null}
      <UsageBar
        usedPercent={headline.window.usedPercent}
        display={display}
        className="h-[5px] w-[30px]"
      />
      <UsageValue
        usedPercent={headline.window.usedPercent}
        display={display}
        className="w-9 text-right text-[12px] font-medium"
      />
    </span>
  )
}

export function UsageRow({
  p,
  label,
  display,
  state,
  showSignInAction,
  now,
  mode = 'verbose'
}: {
  label?: string
  p: ProviderRateLimits
  display: UsagePercentageDisplay
  state: UsageRosterRowState
  showSignInAction: boolean
  now: number
  mode?: StatusBarUsageMode
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const sections = usedSections(p, t)
  const hasUsage = sections.length > 0
  const name = label ?? getProviderDisplayName(p.provider)
  const plan = formatPlanLabel(p.planType)
  // Why: Detailed lists every window below, so a top-right summary would repeat one of them.
  const showDetails = hasUsage && mode === 'verbose'
  const soonestReset = showDetails ? soonestResetLabel(sections, now, intlLocale, t) : null

  return (
    <div data-usage-mode={mode} className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
          <ProviderIcon provider={p.provider} />
        </span>
        <span
          className={cn(
            'shrink truncate text-[13px] font-medium text-foreground',
            // Why: a fixed minimum would leave a gap before the reset that follows a short name.
            showDetails ? 'min-w-0' : 'min-w-14'
          )}
        >
          {name}
          {plan ? <span className="font-normal text-muted-foreground"> · {plan}</span> : null}
        </span>
        {!hasUsage ? (
          <>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {state.statusLabel}
            </span>
            {showSignInAction ? (
              <span className="ml-auto shrink-0 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs text-foreground">
                {t('auto.components.status.bar.StatusBar.c35af53b73', 'Sign in')}
              </span>
            ) : null}
          </>
        ) : showDetails ? (
          soonestReset ? (
            <span data-usage-reset className="shrink-0 text-[11px] text-muted-foreground">
              {soonestReset}
            </span>
          ) : null
        ) : (
          <RowUsageSummary p={p} display={display} now={now} />
        )}
      </div>
      {state.detail ? (
        <span className="pl-[30px] text-[11px] text-muted-foreground">{state.detail}</span>
      ) : null}
      {showDetails ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[30px]">
          {sections.map((section) => {
            const label = shortUsageLabel(p, section, false, t)
            return (
              <DetailMetric
                key={section.label}
                section={section}
                label={label}
                display={display}
                title={scopedUsageTitle(p, { ...section, label }, display, t)}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
