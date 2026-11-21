import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript-api'
import { baseRuleId, scanAstGrep } from '../../structural-scan/ast-grep-scan.mjs'
import { resolvePullRequestDiffBase } from '../../../git/pr-diff-base/git-pull-request-diff-base.mjs'
import { resolveRetainedMergeParents } from '../../../git/pr-diff-base/merge-retained-sources.mjs'
import {
  listTrackedFiles,
  parseCountBaseline,
  runCountRatchet
} from '../../ratchet-baseline/ratchet-baseline.mjs'
import {
  overlapsAddedLines,
  parseAddedLineRanges
} from '../../../git/pr-diff-base/git-diff-line-ranges.mjs'

// Count each flaky-test rule per file so fixing one pattern cannot pay for adding another.

const BASELINE_PATH = 'config/flaky-test-pattern-baseline.txt'
const RULE_FILTER = '^test-'
const FLAKY_RULE = new RegExp(RULE_FILTER)
const HEADER = [
  '# Flaky-test pattern findings per rule and file (config/ast-grep/rules/flaky-tests).',
  '# This is a RATCHET: counts may only go DOWN. Run `pnpm lint:ast-grep:flaky-tests` to list them.',
  '# Prune after a fix: pnpm check:flaky-test-pattern-ratchet --prune'
]

export function countFindings(matches, isTracked = () => true) {
  const counts = new Map()
  for (const match of matches) {
    const file = match.file.split('\\').join('/')
    if (!isTracked(file)) {
      continue
    }
    const key = `${baseRuleId(match.ruleId)}:${file}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** `matches` may come from an unfiltered scan another gate shares; only `test-*` rules count. */
export function collectFlakyTestPatternCounts(
  root = process.cwd(),
  matches = undefined,
  include = () => true
) {
  // Tracked files only, so untracked scratch never changes the baseline.
  const tracked = new Set(listTrackedFiles(root, []))
  const flaky = (matches ?? scanAstGrep(root, { filter: RULE_FILTER })).filter(
    (match) => FLAKY_RULE.test(match.ruleId) && include(match)
  )
  return countFindings(flaky, (file) => tracked.has(file))
}

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // A sync-sized diff (thousands of renames) overflows the 1 MB default with ENOBUFS.
    maxBuffer: 256 * 1024 * 1024,
    ...options
  })
}

function maskStaticImportPaths(file, bytes) {
  const text = bytes.toString('utf8')
  if (!Buffer.from(text).equals(bytes)) {
    return null
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length > 0) {
    return null
  }
  let masked = ''
  let offset = 0
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier
      masked += `${text.slice(offset, specifier.getStart(source) + 1)}<import-path>`
      offset = specifier.end - 1
    }
  }
  return masked + text.slice(offset)
}

function changesOnlyStaticImportPaths(root, base, file) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) {
    return false
  }
  try {
    const current = readFileSync(join(root, file))
    const previous = git(root, ['show', `${base}:${file}`], { encoding: 'buffer' })
    const maskedPrevious = maskStaticImportPaths(file, previous)
    return maskedPrevious !== null && maskedPrevious === maskStaticImportPaths(file, current)
  } catch {
    return false
  }
}

function resolveComparisonBase(root) {
  try {
    const requested = process.env.ORCA_CODE_QUALITY_BASE || 'origin/main'
    const mergeBase = git(root, ['merge-base', 'HEAD', requested]).trim()
    return resolvePullRequestDiffBase(root, mergeBase)
  } catch {
    try {
      return resolvePullRequestDiffBase(root, undefined)
    } catch {
      return null
    }
  }
}

// Scope enforcement to changed files so unrelated merges cannot invalidate every PR's baseline.
function listChangedFilesAtBase(root, base, retainedParents, baseline) {
  const entries = git(root, ['diff', '--name-status', '--no-renames', '-z', base]).split('\0')
  const baselinedFiles = new Set(
    [...baseline].filter(([, count]) => count > 0).map(([key]) => key.slice(key.indexOf(':') + 1))
  )
  const changed = new Set()
  for (let index = 0; index + 1 < entries.length; index += 2) {
    const status = entries[index]
    const file = entries[index + 1]
    if (status === 'M' && changesOnlyStaticImportPaths(root, base, file)) {
      continue
    }
    if (
      baselinedFiles.has(file) ||
      !retainedParents.some((parent) => changesOnlyStaticImportPaths(root, parent, file))
    ) {
      changed.add(file)
    }
  }
  return changed
}

function resolveChangeScope(root) {
  const base = process.env.ORCA_FLAKY_TEST_RATCHET_ALL === '1' ? null : resolveComparisonBase(root)
  if (!base) {
    return { changed: null, retainedParents: [], baseline: new Map() }
  }
  const retainedParents = resolveRetainedMergeParents(root, base)
  const baselinePath = join(root, BASELINE_PATH)
  const baseline =
    retainedParents.length && existsSync(baselinePath)
      ? parseCountBaseline(readFileSync(baselinePath, 'utf8'))
      : new Map()
  const changed = listChangedFilesAtBase(root, base, retainedParents, baseline)
  return { changed, retainedParents, baseline }
}

export function listChangedFiles(root = process.cwd()) {
  return resolveChangeScope(root).changed
}

function listRenamedFiles(root, parent) {
  const entries = git(root, [
    'diff',
    '--name-status',
    '--find-renames',
    '--diff-filter=R',
    '-z',
    parent
  ]).split('\0')
  const renames = new Map()
  for (let index = 0; index + 2 < entries.length; index += 3) {
    // Map the working-tree path to its source at the retained parent.
    renames.set(entries[index + 2], entries[index + 1])
  }
  return renames
}

function readParentChangeRanges(root, parent, file, getRenames) {
  let paths = [file]
  try {
    git(root, ['cat-file', '-e', `${parent}:${file}`])
  } catch {
    const original = getRenames().get(file)
    if (!original) {
      return null
    }
    paths = [original, file]
  }
  const diff = git(root, [
    '--literal-pathspecs',
    'diff',
    '--find-renames',
    '--unified=0',
    '--inter-hunk-context=0',
    '--text',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    parent,
    '--',
    ...paths
  ])
  return parseAddedLineRanges(diff, { includeDeletionBoundaries: true })
}

function newFlakyMatchFilter(root, { changed, retainedParents, baseline }) {
  const parentStates = retainedParents.map((parent) => ({
    parent,
    ranges: new Map(),
    renames: null
  }))
  return (match) => {
    const file = match.file.split('\\').join('/')
    const key = `${baseRuleId(match.ruleId)}:${file}`
    if (!changed?.has(file) || !match.range || baseline.get(key) > 0) {
      return true
    }
    const first = match.range.start.line + 1
    const last = Math.max(first, match.range.end.line + (match.range.end.column === 0 ? 0 : 1))
    return !parentStates.some((state) => {
      if (!state.ranges.has(file)) {
        const getRenames = () => (state.renames ??= listRenamedFiles(root, state.parent))
        state.ranges.set(file, readParentChangeRanges(root, state.parent, file, getRenames))
      }
      const ranges = state.ranges.get(file)
      return ranges !== null && !overlapsAddedLines(first, last, ranges)
    })
  }
}

export function changedFileScope(changed) {
  if (!changed) {
    return undefined
  }
  return (key) => changed.has(key.slice(key.indexOf(':') + 1))
}

export function main(root = process.cwd(), arg = undefined, matches = undefined) {
  const scope = arg === '--prune' ? null : resolveChangeScope(root)
  const include = scope?.retainedParents.length ? newFlakyMatchFilter(root, scope) : undefined
  return runCountRatchet(
    {
      name: 'flaky-test-pattern',
      baselinePath: BASELINE_PATH,
      header: HEADER,
      collect: (dir) => collectFlakyTestPatternCounts(dir, matches, include),
      scope: () => changedFileScope(scope?.changed),
      unit: 'flaky-test finding(s)',
      fix: [
        'Wait on the condition (expect.poll, vi.waitFor, locator assertions) instead of sleeping or',
        'polling, use fake timers or fixed timestamps instead of the wall clock, put',
        '`// quarantine: #<issue> <reason>` above a skip, and a reason comment above a timeout bump.',
        'A deliberate exception takes `// ast-grep-ignore: <rule-id> -- <reason>` above the line.'
      ]
    },
    root,
    arg
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.cwd(), process.argv[2]))
}
