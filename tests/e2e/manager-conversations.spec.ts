import { z } from 'zod'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { getProjectHostSetupForRepo } from '../../src/shared/project-host-setup-lookup'
import { ManagerConversationCatalogSchema } from '../../src/shared/manager-conversation-contract'
import { ManagerConsumerLeaseSchema } from '../../src/shared/manager-principal-contract'

async function call(page: Page, method: string, params: unknown): Promise<unknown> {
  return page.evaluate(
    async ({ method, params }) => {
      const response = await window.api.runtime.call({ method, params })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    { method, params }
  )
}

test('manager objectives and questions survive reload and become read-only after revocation', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const workspaceId = await waitForActiveWorktree(orcaPage)
  const catalog = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return { repos: state.repos, setups: state.projectHostSetups }
  })
  const repo = catalog.repos.find((entry) => workspaceId.startsWith(`${entry.id}::`))
  if (!repo) {
    throw new Error('Manager E2E needs its isolated seeded repository')
  }
  const project = getProjectHostSetupForRepo(catalog.setups, repo)
  const credential = z.object({ principal: z.object({ id: z.string() }), token: z.string() }).parse(
    await call(orcaPage, 'manager.issue', {
      label: 'Isolated test manager',
      expiresAt: Date.now() + 120_000,
      grant: {
        scope: { executionHostIds: ['local'], projectIds: [project.projectId], runIds: [] },
        actions: [
          'run:create',
          'inventory:read',
          'events:read',
          'events:checkpoint',
          'conversation:write'
        ]
      }
    })
  )
  await orcaPage.getByRole('button', { name: 'Manager', exact: true }).click()
  await expect(orcaPage.getByRole('heading', { name: 'Hermes manager' })).toBeVisible()
  await orcaPage
    .getByLabel('Objective', { exact: true })
    .fill('Keep this isolated objective within its granted project')
  await orcaPage.getByRole('button', { name: 'Send objective', exact: true }).click()
  await expect(orcaPage.getByText('Queued for the manager.', { exact: false })).toBeVisible()
  await expect(orcaPage.getByLabel('Message Hermes', { exact: true })).toBeEnabled()
  const conversations = ManagerConversationCatalogSchema.parse(
    await call(orcaPage, 'manager.conversationsList', { offset: 0, limit: 50 })
  )
  const runId = conversations.conversations[0]?.runId
  if (!runId) {
    throw new Error('Manager objective did not create a canonical conversation')
  }
  const { lease } = z.object({ lease: ManagerConsumerLeaseSchema }).parse(
    await call(orcaPage, 'manager.consumerClaim', {
      serviceToken: credential.token,
      consumerId: 'isolated-render-test',
      durationMs: 60_000
    })
  )
  await call(orcaPage, 'manager.conversationPost', {
    serviceToken: credential.token,
    lease,
    runId,
    requestId: 'isolated-question',
    body: 'Which validation should I run before continuing?',
    kind: 'question'
  })
  await orcaPage.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(
    orcaPage.getByText('Which validation should I run before continuing?', { exact: true })
  ).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Answer', exact: true }).click()
  await orcaPage
    .getByLabel('Answer the selected question', { exact: true })
    .fill('Run the scoped tests; do not touch existing user sessions')
  await orcaPage.getByRole('button', { name: 'Send reply', exact: true }).click()
  await expect(orcaPage.getByText('Answered', { exact: true })).toBeVisible()
  await expect(
    orcaPage.getByText('Run the scoped tests; do not touch existing user sessions', { exact: true })
  ).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('manager-conversation-desktop.png') })
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await orcaPage.getByRole('button', { name: 'Manager', exact: true }).click()
  await orcaPage
    .getByRole('button', {
      name: 'Keep this isolated objective within its granted project',
      exact: true
    })
    .click()
  await expect(orcaPage.getByText('Answered', { exact: true })).toBeVisible()
  await call(orcaPage, 'manager.revoke', { principalId: credential.principal.id })
  await orcaPage.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(orcaPage.getByText('revoked', { exact: true })).toBeVisible()
  await expect(orcaPage.getByLabel('Message Hermes', { exact: true })).toBeDisabled()
  await expect(orcaPage.getByRole('button', { name: 'Send reply', exact: true })).toBeDisabled()
  await orcaPage.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  await orcaPage.setViewportSize({ width: 390, height: 844 })
  await expect(orcaPage.getByRole('heading', { name: 'Hermes manager' })).toBeInViewport()
  await expect(orcaPage.getByRole('button', { name: 'Refresh', exact: true })).toBeInViewport()
  await expect(orcaPage.getByLabel('Message Hermes', { exact: true })).toBeInViewport()
  await orcaPage.screenshot({ path: testInfo.outputPath('manager-conversation-narrow.png') })
  const hidden = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every((window) => !window.isVisible())
  )
  expect(hidden).toBe(true)
})
