import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '../..')
const require = createRequire(resolve(repo, 'package.json'))
const fixture = readFileSync(
  resolve(repo, 'src/main/runtime/__fixtures__/codex-0-158-0-timed-turn.txt'),
  'utf8'
)
// eslint-disable-next-line no-control-regex -- Replay the captured ANSI modes, not recalled TUI behavior.
const mouseModes = fixture.match(/\x1b\[\?100[0236]h/g)?.join('')
assert.ok(mouseModes, 'Captured Codex transcript must enable mouse reporting')
const bundle = await build({
  stdin: {
    resolveDir: repo,
    contents: `
      import { Terminal } from '@xterm/xterm';
      import { buildDefaultTerminalOptions } from './src/renderer/src/lib/pane-manager/pane-terminal-options';
      import { writeWebClipboardText } from './src/renderer/src/web/preload-api/web-clipboard-api';
      import { copyTerminalSelection } from './src/renderer/src/components/terminal-pane/terminal-selection-copy';
      import { installTerminalNativeCopyGutterTrim } from './src/renderer/src/components/terminal-pane/terminal-native-copy-gutter';
      const args = new URLSearchParams(location.search);
      window.__ORCA_WEB_CLIENT__ = args.get('web') === '1';
      const originalClipboard = navigator.clipboard;
      window.readLocalClipboard = () => originalClipboard.readText();
      if (args.get('fallback') === '1') Object.defineProperty(navigator, 'clipboard', {value: undefined});
      window.smoke = { reports: 0, rpcCalls: 0, ready: false, copied: false };
      const terminal = new Terminal({...buildDefaultTerminalOptions(), cols: 80, rows: 18});
      window.testTerminal = terminal;
      terminal.open(document.getElementById('terminal'));
      installTerminalNativeCopyGutterTrim(terminal);
      terminal.onData(() => window.smoke.reports++);
      terminal.onSelectionChange(() => {
        if (terminal.hasSelection()) void copyTerminalSelection({terminal, writeClipboardText: writeWebClipboardText}).then(copied => window.smoke.copied = copied);
      });
      const button = document.getElementById('copy');
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => void copyTerminalSelection({terminal, writeClipboardText: writeWebClipboardText}).then(copied => window.smoke.copied = copied);
      terminal.write(${JSON.stringify(mouseModes)} + 'Synthetic Codex answer to copy\\r\\n', () => {
        terminal.focus(); window.smoke.ready = true;
      });
    `
  },
  alias: { '@': resolve(repo, 'src/renderer/src') },
  plugins: [
    {
      name: 'no-runtime-clipboard-fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^@\/store$/ }, () => ({ path: 'store', namespace: 'fixtures' }))
        plugin.onResolve({ filter: /^\.\/web-runtime-calls$/ }, () => ({
          path: 'rpc',
          namespace: 'fixtures'
        }))
        plugin.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path }) => ({
          contents:
            path === 'store'
              ? 'export const useAppStore = {getState:()=>({settings:{terminalCopyTrimsGutter:true}})};'
              : 'export function callRuntimeResult(){window.smoke.rpcCalls++;throw Error("Clipboard must not call the server")}; export const callRuntimeEnvelope=callRuntimeResult;'
        }))
      }
    }
  ],
  bundle: true,
  format: 'iife',
  write: false
})
const css = readFileSync(require.resolve('@xterm/xterm/css/xterm.css'))
const html =
  '<!doctype html><link rel="stylesheet" href="/xterm.css"><button id="copy">Copy selection</button><div id="terminal" style="width:800px;height:400px"></div><script src="/smoke.js"></script>'
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  response.setHeader(
    'Content-Type',
    pathname === '/smoke.js'
      ? 'text/javascript'
      : pathname === '/xterm.css'
        ? 'text/css'
        : 'text/html'
  )
  response.end(
    pathname === '/smoke.js' ? bundle.outputFiles[0].text : pathname === '/xterm.css' ? css : html
  )
})
let browser
try {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  for (const [web, fallback] of [
    [false, false],
    [true, false],
    [true, true]
  ]) {
    await page.goto(`${origin}/?web=${Number(web)}&fallback=${Number(fallback)}`)
    await page.waitForFunction(() => window.smoke?.ready)
    const box = await page.locator('.xterm-screen').boundingBox()
    assert.ok(box)
    await page.mouse.move(box.x + 3, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 235, box.y + 10, { steps: 10 })
    await page.mouse.up()
    const selection = await page.evaluate(() => window.testTerminal.getSelection())
    if (!web) {
      assert.equal(selection, '')
      assert.ok(await page.evaluate(() => window.smoke.reports > 0))
      console.log(
        'REPRODUCED: ordinary Codex-mode drags go to the host TUI, not terminal selection'
      )
      continue
    }
    assert.ok(
      selection.includes('Codex'),
      `Expected Codex browser selection, got ${JSON.stringify(selection)}`
    )
    await page.waitForFunction(() => window.smoke.copied)
    assert.equal(await page.evaluate(() => window.readLocalClipboard()), selection)
    await page.evaluate(() => {
      window.smoke.copied = false
    })
    await page.click('#copy')
    await page.waitForFunction(() => window.smoke.copied)
    assert.equal(await page.evaluate(() => window.readLocalClipboard()), selection)
    assert.equal(await page.evaluate(() => window.smoke.rpcCalls), 0)
    assert.equal(await page.evaluate(() => window.smoke.reports), 0)
    await page.keyboard.down('Alt')
    await page.mouse.click(box.x + 60, box.y + 10)
    await page.keyboard.up('Alt')
    assert.ok(await page.evaluate(() => window.smoke.reports > 0))
    console.log(
      `PASS: browser-local auto/manual copy, no host RPC/mouse input, Alt TUI clicks (${fallback ? 'HTTP fallback' : 'Clipboard API'})`
    )
  }
} finally {
  if (browser) {
    await browser.close()
  }
  await new Promise((resolveClose) => server.close(resolveClose))
}
