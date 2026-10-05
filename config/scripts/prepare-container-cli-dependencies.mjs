import { cpSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Containers can read the checkout while the host home containing pnpm's store is masked.
const root = resolve(import.meta.dirname, '../..')
const destination = join(root, 'out', 'node_modules')
mkdirSync(destination, { recursive: true })
for (const dependency of [
  'zod',
  'ws',
  'yaml',
  'tweetnacl',
  '@xterm/headless',
  '@xterm/addon-serialize',
  '@xterm/addon-unicode11'
]) {
  cpSync(join(root, 'node_modules', dependency), join(destination, dependency), {
    recursive: true,
    dereference: true
  })
}
console.log('Prepared shared, standalone CLI dependencies.')
