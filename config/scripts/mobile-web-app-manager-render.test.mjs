import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { buildMobileWebAppBundle } from './build-mobile-web-app-bundle.mjs'
import {
  createBundleServer,
  installShellDouble,
  readBridgeFaultGrant,
  readBridgeProtocolVersion,
  readShellCsp
} from './mobile-web-app-render-harness.mjs'
import { MOBILE_WEB_PAGE_ROUTES } from './mobile-web-page-routes.mjs'
import {
  MANAGER_RENDER_HOST,
  MANAGER_RENDER_OWNER,
  installManagerRenderReplies
} from './mobile-web-app-manager-render-fixture.mjs'

const PATH = `/h/${MANAGER_RENDER_HOST.id}/manager`
let scratch, server, browser, origin, version, faultGrant
let grants
beforeAll(async () => {
  version = await readBridgeProtocolVersion()
  faultGrant = await readBridgeFaultGrant()
  grants = [
    faultGrant,
    ...MOBILE_WEB_PAGE_ROUTES.find((route) => route.pathname === '/h/[hostId]/manager').grants
  ]
  scratch = await mkdtemp(join(tmpdir(), 'orca-mobile-manager-render-'))
  const built = await buildMobileWebAppBundle({ outDir: join(scratch, 'bundle') })
  const served = await createBundleServer({ outDir: built.outDir, cspHeader: await readShellCsp() })
  server = served.server
  origin = served.origin
  const executablePath = process.env.ORCA_MOBILE_WEB_RENDER_BROWSER
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
}, 180_000)
afterAll(async () => {
  await browser?.close()
  server?.close()
  if (scratch) {
    await rm(scratch, { recursive: true, force: true })
  }
})

async function open(granted = grants) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (entry) => {
    if (entry.type() === 'error') {
      errors.push(entry.text())
    }
  })
  const shell = {
    version,
    faultGrant,
    sessionId: 'manager-render-session',
    buildId: 'manager-render-build',
    host: MANAGER_RENDER_HOST,
    route: { pathname: PATH, params: { runId: 'run-a' } },
    storage: {},
    grants: granted,
    pageRoutes: ['/h/[hostId]/manager']
  }
  const replies = { version, ownerKey: MANAGER_RENDER_OWNER }
  await page.addInitScript({
    content: `(${installShellDouble.toString()})(${JSON.stringify(shell)}); (${installManagerRenderReplies.toString()})(${JSON.stringify(replies)});`
  })
  await page.goto(origin, { waitUntil: 'load' })
  return { page, errors }
}

describe('the mobile manager page under the shipped shell CSP', () => {
  it('renders the exact deep-linked objective and safely sends an answer through native recovery', async () => {
    const { page, errors } = await open()
    try {
      await page.getByText('Objective run-a', { exact: true }).waitFor()
      await page.getByText('Choose the safe approach for run-a.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Answer question 1', exact: true }).click()
      await page
        .getByRole('textbox', { name: 'Answer manager question', exact: true })
        .fill('Use the approved isolated worker.')
      await page.getByRole('button', { name: 'Send answer', exact: true }).click()
      await page.getByRole('textbox', { name: 'Message manager', exact: true }).waitFor()
      expect(
        await page.getByRole('textbox', { name: 'Message manager', exact: true }).inputValue()
      ).toBe('')
      const requests = await page.evaluate(() => globalThis.__orcaRenderCheckRequests)
      expect(
        requests.find((row) => row.method === 'manager.conversationSend').params
      ).toMatchObject({
        runId: 'run-a',
        replyTo: 'question-run-a',
        body: 'Use the approved isolated worker.'
      })
      const receiptOperations = await page.evaluate(() => globalThis.__orcaManagerReceipts)
      expect(receiptOperations).toContain('save')
      expect(receiptOperations.at(-1)).toBe('clear')
      expect(await page.evaluate(() => location.pathname + location.search)).toBe(
        `${PATH}?runId=run-a`
      )
      expect(errors).toEqual([])
    } finally {
      await page.close()
    }
  }, 60_000)

  it('does not send owner RPCs or fall back to DOM storage when an older shell lacks native recovery', async () => {
    const { page, errors } = await open(
      grants.filter((grant) => grant !== 'native.manager.receipt')
    )
    try {
      await page.getByText(/This mobile app cannot safely recover manager requests/).waitFor()
      const requests = await page.evaluate(() => globalThis.__orcaRenderCheckRequests)
      expect(requests.filter((row) => row.method.startsWith('manager.'))).toEqual([])
      expect(errors).toEqual([])
    } finally {
      await page.close()
    }
  }, 60_000)

  it('opens the newly targeted objective when another notification changes the run on the same route', async () => {
    const { page, errors } = await open()
    try {
      await page.getByText('Objective run-a', { exact: true }).waitFor()
      await page.evaluate((path) => {
        history.pushState(null, '', `${path}?runId=run-b`)
        dispatchEvent(new PopStateEvent('popstate'))
      }, PATH)
      await page.getByText('Objective run-b', { exact: true }).waitFor()
      expect(await page.getByText('Objective run-a', { exact: true }).count()).toBe(0)
      expect(errors).toEqual([])
    } finally {
      await page.close()
    }
  }, 60_000)
})
