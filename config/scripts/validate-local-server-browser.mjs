import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const profile = await mkdtemp(join(tmpdir(), 'orca-local-server-browser-'))
const personal = JSON.parse(
  execFileSync(
    'podman',
    [
      'exec',
      'personal',
      '/usr/bin/node',
      '-e',
      'process.stdout.write(require("fs").readFileSync("/home/developer/.config/orca/orca-environments.json"))'
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  )
)
const environment = personal.environments.find((item) => item.name === 'skyron-host')
if (!environment) {
  throw new Error('Validation pairing not found')
}
const { ELECTRON_RUN_AS_NODE: _runAsNode, NODE_OPTIONS: _nodeOptions, ...env } = process.env
let browser
let child
try {
  child = spawn(
    resolve('node_modules/electron/dist/electron'),
    [
      '--no-sandbox',
      '--remote-debugging-port=0',
      resolve('config/scripts/local-server-browser-window.cjs')
    ],
    {
      env: { ...env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_VALIDATION_PROFILE: profile },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  )
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error('Validation browser startup timed out')), 30000)
    let log = ''
    child.stderr.on('data', (chunk) => {
      log = (log + chunk).slice(-4096)
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log)
      if (match) {
        clearTimeout(timer)
        resolveEndpoint(match[1])
      }
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('Validation browser exited'))
    })
  })
  browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  const artifactUrl = process.env.ORCA_VALIDATION_ARTIFACT_URL
  if (artifactUrl) {
    const response = await page.goto(artifactUrl, { waitUntil: 'load', timeout: 15000 })
    const artifact = await page.evaluate(() => ({
      title: document.title,
      javascript: document.getElementById('javascript')?.textContent,
      isolation: document.getElementById('isolation')?.textContent
    }))
    if (
      response?.status() !== 200 ||
      artifact.javascript !== 'Sandboxed JavaScript: working.' ||
      artifact.isolation !== 'Origin isolation: working (application storage is inaccessible).'
    ) {
      throw new Error('Local artifact browser validation failed')
    }
    console.log(
      JSON.stringify({ phase: 'artifact-viewer', status: response.status(), ...artifact })
    )
  }
  await page.addInitScript((value) => {
    localStorage.setItem('orca.web.runtimeEnvironment.v1', JSON.stringify(value))
  }, environment)
  const failures = []
  page.on('pageerror', (error) => failures.push(error.name))
  await page.goto('http://100.64.0.3:6768', { waitUntil: 'domcontentloaded', timeout: 30000 })
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true })
  const backButton = page.getByRole('button', { name: 'Back to app', exact: true })
  try {
    await settingsButton.or(backButton).first().waitFor({ timeout: 45000 })
  } catch {
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          phase: 'connection-diagnostic',
          title: document.title,
          apiPresent: Boolean(window.api),
          secureContext: window.isSecureContext,
          headings: [...document.querySelectorAll('h1,h2')].map((element) => element.textContent),
          buttons: [...document.querySelectorAll('button')]
            .map((element) => element.getAttribute('aria-label') || element.textContent?.trim())
            .slice(0, 20)
        }))
      )
    )
    console.log(JSON.stringify({ pageErrors: failures }))
    throw new Error('Paired browser did not reach the connected application')
  }
  console.log(JSON.stringify({ phase: 'connected', background: true, pageErrors: failures }))
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        settingsButtons: [...document.querySelectorAll('button')]
          .map((button) => ({
            label: button.getAttribute('aria-label'),
            title: button.getAttribute('title'),
            text: button.textContent?.trim()
          }))
          .filter((item) => /settings/i.test(`${item.label} ${item.title} ${item.text}`))
      }))
    )
  )
  const usageNavigation = page.getByRole('button', { name: /Stats & Usage/ })
  // Why: host preferences can restore Settings after the initial app shell has painted.
  // Wait for that destination, not an instantaneous Back-button visibility snapshot.
  const settingsRestored = await usageNavigation.waitFor({ timeout: 5000 }).then(
    () => true,
    () => false
  )
  if (!settingsRestored) {
    await settingsButton.click()
  }
  await backButton.waitFor({ timeout: 15000 })
  await usageNavigation.click()
  const quotas = page.getByTestId('usage-tracking-live-quotas')
  await quotas.locator('[data-execution-account]').first().waitFor({ timeout: 30000 })
  const usageTracking = await page.evaluate(async () => {
    const states = {}
    for (const provider of ['claudeUsage', 'codexUsage', 'openCodeUsage', 'museUsage']) {
      const state = await window.api[provider].getScanState()
      if (typeof state?.enabled !== 'boolean') {
        throw new Error(`${provider} returned a stub`)
      }
      states[provider] = {
        enabled: state.enabled,
        scanning: state.isScanning,
        error: state.lastScanError
      }
    }
    return states
  })
  const quotaRows = await quotas.locator('[data-execution-account]').count()
  if (quotaRows < 5) {
    throw new Error('Usage Tracking is missing execution-host quotas')
  }
  console.log(JSON.stringify({ phase: 'usage-tracking', quotaRows, states: usageTracking }))
  await page.getByRole('button', { name: /AI Provider Accounts/ }).click()
  await page.locator('[data-execution-account]').first().waitFor({ timeout: 30000 })
  for (const section of [
    'accounts-claude',
    'accounts-codex',
    'accounts-cursor',
    'accounts-gemini',
    'accounts-opencode-go'
  ]) {
    const rows = await page.locator(`#${section} [data-execution-account]`).count()
    if (!rows) {
      throw new Error(`Missing execution-host usage rows in ${section}`)
    }
    console.log(JSON.stringify({ phase: 'provider-settings', section, rows }))
  }
  await page.getByRole('button', { name: /^Artifacts/ }).click()
  await page.getByText('Allow publishing server-hosted artifact links', { exact: true }).waitFor()
  console.log(JSON.stringify({ phase: 'artifact-settings', localHosting: true }))
  await page.getByRole('button', { name: /^Open Artifacts/ }).click()
  await page.getByRole('button', { name: /orca-local-artifact-test.html/ }).click()
  const preview = page.frameLocator('iframe[title="Artifact preview"]')
  await preview
    .getByRole('heading', { name: 'Server-local artifacts work' })
    .waitFor({ timeout: 15000 })
  await preview.getByText('Sandboxed JavaScript: working.', { exact: true }).waitFor()
  await preview
    .getByText('Origin isolation: working (application storage is inaccessible).', { exact: true })
    .waitFor()
  console.log(
    JSON.stringify({
      phase: 'artifact-preview',
      sandbox: await page.locator('iframe[title="Artifact preview"]').getAttribute('sandbox')
    })
  )
  if (process.env.ORCA_VALIDATION_PDF_NAME) {
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page
      .getByRole('button', { name: new RegExp(process.env.ORCA_VALIDATION_PDF_NAME) })
      .click()
    const pdf = page.getByTestId('artifact-pdf-preview')
    await pdf.locator('canvas').first().waitFor({ timeout: 30000 })
    if (await pdf.getByRole('alert').count()) {
      throw new Error('PDF preview failed')
    }
    console.log(
      JSON.stringify({ phase: 'pdf-preview', canvases: await pdf.locator('canvas').count() })
    )
  }
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          phase: 'failure-diagnostic',
          headings: [...document.querySelectorAll('h1,h2,h3')].map(
            (element) => element.textContent
          ),
          buttons: [...document.querySelectorAll('button')]
            .map((element) => element.getAttribute('aria-label') || element.textContent?.trim())
            .slice(0, 80)
        }))
      )
    )
  }
  throw error
} finally {
  await browser?.close()
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
