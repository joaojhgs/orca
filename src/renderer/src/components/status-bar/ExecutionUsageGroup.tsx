import { ChevronRight } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ExecutionAccountUsage } from '../../../../shared/execution-observer'

/** Keep account/provider disclosure inside the roster without closing its menu. */
export function ExecutionUsageGroup({
  accounts,
  label,
  renderRow
}: {
  accounts: ExecutionAccountUsage[]
  label: string
  renderRow: (account: ExecutionAccountUsage) => React.ReactNode
}): React.JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <DropdownMenuItem
          onSelect={(event) => event.preventDefault()}
          className="group w-full cursor-pointer justify-between rounded-none px-3.5 py-2.5"
        >
          <span className="truncate">{label}</span>
          <ChevronRight className="shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        </DropdownMenuItem>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-80 overflow-y-auto scrollbar-sleek">
        {accounts.map((account) => (
          <div
            key={account.id}
            data-execution-account={account.id}
            className="flex flex-col gap-1.5 px-3.5 py-2.5"
          >
            <p className="whitespace-normal text-[11px] text-muted-foreground">
              {account.providerId ?? account.provider} · {account.id.slice(0, 8)} ·{' '}
              {account.sources
                .map((source) => `${source.label}${source.reachable ? '' : ' (unverifiable)'}`)
                .join(' + ')}
              {account.sources.length > 1
                ? account.identityConfidence === 'account'
                  ? ' · same account'
                  : ' · same credential'
                : ''}
            </p>
            {account.rateLimits ? (
              renderRow(account)
            ) : (
              <p className="text-xs text-muted-foreground">Usage not verified yet</p>
            )}
            {account.identityConfidence === 'unknown' ? (
              <p className="text-[11px] text-muted-foreground">Account identity not verified</p>
            ) : null}
            {account.error || account.rateLimits?.error ? (
              <p className="whitespace-normal text-[11px] text-muted-foreground">
                {account.error || account.rateLimits?.error}
              </p>
            ) : null}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
