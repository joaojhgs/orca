import { expect } from '@stablyai/playwright-test'
import { test } from './desktop/electron-fixtures/orca-app'
import { waitForSessionReady } from './desktop/renderer-probes/store'

async function openNotificationSettings(
  page: Parameters<typeof waitForSessionReady>[0]
): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'notifications', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.getByPlaceholder('Search settings')).toBeVisible({ timeout: 10_000 })
  const featureTipDialog = page.getByRole('dialog', { name: 'Voice Dictation is here' })
  if (await featureTipDialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Maybe Later' }).click()
  }
  await expect(
    page
      .locator('[data-settings-section="notifications"]')
      .getByRole('heading', { name: 'Notifications', exact: true })
  ).toBeInViewport({ timeout: 10_000 })
}

test.describe('Notification settings', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
  })

  test('saves a server scope rule independently of manager supervision', async ({
    orcaPage
  }, testInfo) => {
    await openNotificationSettings(orcaPage)
    const section = orcaPage.locator('[data-settings-section="notifications"]')
    await section.getByRole('button', { name: 'Project and session rules' }).click()
    await expect(section.getByRole('button', { name: 'Save rule', exact: true })).toBeVisible()
    await section
      .getByRole('radiogroup', { name: 'Human alerts', exact: true })
      .getByRole('radio', { name: 'Off', exact: true })
      .click()
    await section
      .getByRole('radiogroup', { name: 'Manager event subscription', exact: true })
      .getByRole('radio', { name: 'On', exact: true })
      .click()
    await section.getByRole('button', { name: 'Save rule', exact: true }).click()
    await expect(section.locator('output').first()).toContainText('human muted by server override')
    await expect(section.locator('output').first()).toContainText('manager subscribed')
    await section.getByRole('button', { name: 'Refresh scopes', exact: true }).click()
    await expect(section.getByRole('button', { name: 'Save rule', exact: true })).toBeVisible()
    await expect(
      section
        .getByRole('radiogroup', { name: 'Human alerts', exact: true })
        .getByRole('radio', { name: 'Off', exact: true })
    ).toHaveAttribute('aria-checked', 'true')
    await expect(section.locator('output').first()).toContainText('manager subscribed')
    await testInfo.attach('scoped-notification-policy', {
      body: await section.screenshot({
        path: testInfo.outputPath('scoped-notification-policy.png')
      }),
      contentType: 'image/png'
    })
  })
})
