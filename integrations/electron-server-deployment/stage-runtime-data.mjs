import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const destination = process.argv[2] && resolve(process.argv[2])
if (!destination || destination === resolve(sourceRoot)) {
  throw new Error('Provide the server release staging directory, outside the source checkout')
}
const sourceRequire = createRequire(join(sourceRoot, 'package.json'))
const declared = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'))
const packageFile = sourceRequire.resolve('emojibase-data/package.json')
const metadata = JSON.parse(readFileSync(packageFile, 'utf8'))
if (
  metadata.version !==
  (declared.dependencies?.['emojibase-data'] ?? declared.devDependencies?.['emojibase-data'])
) {
  throw new Error('Installed emojibase-data does not match the release dependency')
}
const dataset = 'emojibase-data/en/shortcodes/emojibase.json'
for (const [source, relative] of [
  [packageFile, 'emojibase-data/package.json'],
  [sourceRequire.resolve(dataset), dataset]
]) {
  const target = join(destination, 'node_modules', relative)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}
const releaseRequire = createRequire(join(destination, 'out/main/chunks/runtime-data-check.cjs'))
if (!releaseRequire(dataset)['1F600']) {
  throw new Error('Release main chunks cannot load the emoji shortcode dataset')
}
console.log(`Staged and verified emojibase-data ${metadata.version}`)
