// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/agent-usage/rate-limits/rate-limit-types'

const mocks = vi.hoisted(() => ({
  now: 1_000_000_000,
  useResetCountdownClock: vi.fn(() => 1_000_000_000)
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
  getIntlLocale: () => 'en'
}))
vi.mock('@/lib/agent-catalog/agent-catalog', () => ({
  AgentIcon: ({ agent }: { agent: string }) => <span data-agent-icon={agent} />
}))
vi.mock('@/components/status-bar/usage/useResetCountdownClock', () => ({
  useResetCountdownClock: mocks.useResetCountdownClock
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect: _onSelect,
    ...props
  }: React.PropsWithChildren<{ onSelect?: () => void }>) => <div {...props}>{children}</div>
}))

import { UsageRow } from './usage/UsageRosterPanel'
import { ExecutionUsageGroup } from './ExecutionUsageGroup'
import type { ExecutionAccountUsage } from '../../../../shared/execution-observer'

const signedOutCodex: ProviderRateLimits = {
  provider: 'codex',
  session: null,
  weekly: null,
  updatedAt: 0,
  error: 'ChatGPT authentication required to read rate limits',
  status: 'error'
}

describe('execution-account drilldown', () => {
  it('expands distinct accounts, source hosts and OpenCode provider quota rows without closing the roster', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const account = (id: string, providerId: string): ExecutionAccountUsage => ({
      id,
      provider: 'opencode',
      providerId,
      sourceRef: `opencode:${providerId}`,
      accountKey: null,
      identityConfidence: 'unknown',
      checkedAt: 1,
      retryAt: 1,
      sources: [
        {
          executionHostId: 'ssh:personal',
          label: 'Personal distrobox',
          sourceRef: providerId,
          reachable: true
        }
      ],
      rateLimits: {
        ...signedOutCodex,
        provider: 'opencode',
        status: 'ok',
        error: null,
        weekly: {
          usedPercent: id === 'first' ? 20 : 40,
          windowMinutes: 10080,
          resetsAt: null,
          resetDescription: null
        }
      }
    })
    try {
      await act(async () =>
        root.render(
          <ExecutionUsageGroup
            accounts={[account('first', 'zai-coding-plan'), account('second', 'opencode-go')]}
            label="OpenCode · 2 providers"
            renderRow={(account) => (
              <UsageRow
                p={account.rateLimits!}
                display="used"
                state={{ kind: 'usage', statusLabel: null }}
                showSignInAction={false}
                now={mocks.now}
              />
            )}
          />
        )
      )
      expect(container.querySelectorAll('[data-execution-account]')).toHaveLength(0)
      await act(async () =>
        container.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')?.click()
      )
      expect(container.querySelectorAll('[data-execution-account]')).toHaveLength(2)
      expect(container.textContent).toContain('Personal distrobox')
      expect(container.textContent).toContain('zai-coding-plan')
      expect(container.textContent).toContain('opencode-go')
      expect(container.textContent).toContain('20%')
      expect(container.textContent).toContain('40%')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
