import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const output = process.argv[2]
if (!output) throw new Error('Provide the isolated output directory')
await build({
  absWorkingDir: root,
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: resolve(output, 'index.cjs'),
  tsconfig: 'config/tsconfig.cli.json',
  external: ['electron', 'better-sqlite3', 'node-pty', '@parcel/watcher']
})
