import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { appendBuildOldSpaceOption } from './node-old-space-limit.mjs'
import { RENDERER_BUILD_DIR, verifyRendererBootGraph } from './renderer-boot-graph.mjs'

const require = createRequire(import.meta.url)
const electronVitePackageJson = require.resolve('electron-vite/package.json')
const electronViteCli = path.join(path.dirname(electronVitePackageJson), 'bin', 'electron-vite.js')

// Release builds have started OOMing on GitHub's macOS runners during the
// renderer bundle. Reserve memory on smaller hosts so the OS does not kill Vite.
const nodeOptions = appendBuildOldSpaceOption(process.env.NODE_OPTIONS)

const outputArgs = process.env.ORCA_BUILD_OUTPUT_DIR
  ? ['--outDir', process.env.ORCA_BUILD_OUTPUT_DIR]
  : []
const child = spawn(
  process.execPath,
  [electronViteCli, 'build', ...outputArgs, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions
    }
  }
)

child.on('exit', async (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  if (code !== 0) {
    process.exit(code ?? 1)
  }

  // Why here: this is the only place a real renderer bundle exists, and the
  // boot graph is exactly what a stray static import silently regresses. The
  // target gate keeps the parallel runner's concurrent main/preload builds from
  // reading out/renderer while the renderer target is still writing it.
  const target = process.env.ORCA_ELECTRON_VITE_TARGET
  if (!target || target === 'main') {
    try {
      // Why: main clears its output directory first; add the standalone observer after it finishes.
      await import('./build-execution-observer.mjs')
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  }
  const builtRenderer =
    (!target || target === 'renderer') && fs.existsSync(path.join(RENDERER_BUILD_DIR, 'index.html'))
  process.exit(builtRenderer ? verifyRendererBootGraph() : 0)
})
