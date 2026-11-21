import { execFileSync, spawnSync } from 'node:child_process'

const mode = process.argv[2]
if (!['format', 'lint'].includes(mode)) {
  throw new Error('Choose format or lint')
}
const tracked = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR'], {
  encoding: 'utf8'
})
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
  encoding: 'utf8'
})
const files = [
  ...new Set(
    `${tracked}\n${untracked}`.split('\n').filter((file) => /\.(?:ts|tsx|mjs|json)$/.test(file))
  )
]
const bin = mode === 'format' ? 'node_modules/oxfmt/bin/oxfmt' : 'node_modules/oxlint/bin/oxlint'
const args = mode === 'format' ? [] : ['--fix']
const child = spawnSync(process.execPath, [bin, ...args, ...files], {
  stdio: 'inherit',
  env: process.env
})
if (child.error) {
  throw child.error
}
process.exitCode = child.status ?? 1
