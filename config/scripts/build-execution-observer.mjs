import { build } from 'esbuild'
import { resolve, join } from 'node:path'

await build({
  entryPoints: ['src/main/execution-observer/observer-entry.ts'],
  outfile: join(process.env.ORCA_BUILD_OUTPUT_DIR || 'out', 'main', 'execution-observer.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  // Why: stdin execution has filename '[stdin]', which createRequire rejects.
  banner: { js: "__filename = require('node:path').resolve('.orca-execution-observer.cjs');" },
  plugins: [
    {
      name: 'observer-node-network',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'observer'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'observer' }, () => ({
          contents: `import os from 'node:os'; export const net = { fetch: (...args) => globalThis.fetch(...args) }; export const session = { defaultSession: { resolveProxy: async () => 'DIRECT', setProxy: async () => {} } }; export const app = { getPath: name => name === 'home' ? os.homedir() : process.env.XDG_CONFIG_HOME || os.homedir() + '/.config', isPackaged: false, getAppPath: () => process.cwd() };`,
          loader: 'js',
          resolveDir: resolve('.')
        }))
      }
    }
  ]
})
