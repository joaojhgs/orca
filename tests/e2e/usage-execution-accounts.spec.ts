import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('usage roster expands distinct accounts and OpenCode providers without dismissing the popup', async ({
  electronApp
}, testInfo) => {
  const orcaPage = await electronApp.firstWindow()
  await orcaPage.waitForLoadState('domcontentloaded')
  // Access the production store export only in this fixture's isolated profile.
  // Real clients keep debug hooks off and do not need a different build.
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'out/renderer/.vite/manifest.json'), 'utf8')
  )
  await orcaPage.evaluate(async (file: string) => {
    const module = await import(new URL(file, window.location.href).href)
    window.__store = module.useAppStore
  }, manifest['src/store/index.ts'].file)
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => {
    const store = window.__store!
    const state = store.getState()
    const limits = (provider: 'claude' | 'opencode', usedPercent: number) => ({
      provider,
      session: null,
      weekly: { usedPercent, windowMinutes: 10080, resetsAt: null, resetDescription: null },
      updatedAt: Date.now(),
      error: null,
      status: 'ok' as const
    })
    const account = (
      id: string,
      provider: 'claude' | 'opencode',
      host: string,
      used: number,
      providerId?: string
    ) => ({
      id,
      provider,
      providerId,
      sourceRef: `${provider}:default`,
      accountKey: id.repeat(64),
      identityConfidence: 'account' as const,
      sources: [
        {
          executionHostId: `ssh:${host}`,
          label: host,
          sourceRef: `${provider}:default`,
          reachable: true
        }
      ],
      rateLimits: limits(provider, used),
      checkedAt: Date.now(),
      retryAt: Date.now() + 300000
    })
    store.setState({
      usagePercentageDisplay: 'used',
      statusBarVisible: true,
      statusBarItems: ['claude'],
      detectedAgentIds: ['claude', 'opencode'],
      rateLimits: {
        ...state.rateLimits,
        claude: limits('claude', 25),
        executionAccounts: [
          account('a', 'claude', 'personal-distrobox', 25),
          account('b', 'claude', 'notebook-work', 80),
          account('c', 'opencode', 'personal-distrobox', 20, 'opencode-go'),
          account('d', 'opencode', 'notebook-personal', 60, 'zai-coding-plan')
        ]
      }
    })
  })
  await orcaPage
    .locator('.status-bar-usage-cluster')
    .getByRole('button', { name: 'Usage', exact: true })
    .click()
  const claude = orcaPage.getByRole('menuitem', { name: 'Claude · 2 accounts', exact: true })
  await claude.click()
  await expect(claude).toHaveAttribute('aria-expanded', 'true')
  await expect(orcaPage.locator('[data-execution-account="a"]')).toContainText('personal-distrobox')
  await expect(orcaPage.locator('[data-execution-account="b"]')).toContainText('notebook-work')
  await expect(orcaPage.locator('[data-execution-account="b"]')).toContainText('80%')
  const opencode = orcaPage.getByRole('menuitem', { name: 'OpenCode · 2 providers', exact: true })
  await opencode.focus()
  await orcaPage.keyboard.press('Enter')
  await expect(opencode).toHaveAttribute('aria-expanded', 'true')
  await expect(orcaPage.locator('[data-execution-account="c"]')).toContainText('opencode-go')
  await expect(orcaPage.locator('[data-execution-account="d"]')).toContainText('zai-coding-plan')
  await expect(claude).toBeVisible()
  await expect(opencode).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('usage-accounts.png') })
})
