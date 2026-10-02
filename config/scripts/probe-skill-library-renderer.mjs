import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [phase, outputArgument] = process.argv.slice(2)
if (!['build', 'render'].includes(phase) || !outputArgument) {
  throw new Error(
    'Usage: probe-skill-library-renderer.mjs <build|render> <disposable-output-directory>'
  )
}
const output = resolve(outputArgument)
await mkdir(join(output, 'profile'), { recursive: true })
if (phase === 'build') {
  const { build } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const { default: tailwindcss } = await import('@tailwindcss/vite')
  await build({
    configFile: false,
    root: process.cwd(),
    base: './',
    cacheDir: join(output, 'vite'),
    resolve: {
      alias: {
        '@/runtime/runtime-rpc-client': resolve('config/fixtures/skill-library-probe-rpc.ts'),
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: join(output, 'web'),
      minify: false,
      sourcemap: false,
      rollupOptions: { input: resolve('config/fixtures/skill-library-renderer-probe.html') }
    }
  })
  console.log(`Fixture built: ${output}`)
  process.exit(0)
}
const { _electron: electron, expect } = await import('@playwright/test')
const errors = []
let app
try {
  const url = pathToFileURL(
    join(output, 'web', 'config', 'fixtures', 'skill-library-renderer-probe.html')
  ).href
  app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      resolve('config/fixtures/skill-library-probe-electron.cjs')
    ],
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_LIBRARY_PROBE_PROFILE: join(output, 'profile'),
      ORCA_LIBRARY_PROBE_URL: url
    },
    timeout: 30000
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(
    page.getByRole('heading', { name: 'Local skill library', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Scan host', exact: true }).click()
  await page.getByRole('button', { name: 'Review import', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Import into local library', exact: true })
  ).toBeDisabled()
  await page.getByRole('checkbox').first().check()
  await page.screenshot({ path: join(output, 'desktop-review.png') })
  await page.getByRole('button', { name: 'Import into local library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved versions (1)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  await page.getByRole('dialog').getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Fixture distrobox', exact: true }).click()
  await page.getByRole('button', { name: 'Assign pinned version', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Assignments (1)', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: join(output, 'mobile-library.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  expect(errors).toEqual([])
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  console.log(`Hidden desktop/mobile renderer probe passed. Screenshots: ${output}`)
} finally {
  await app?.close()
}
