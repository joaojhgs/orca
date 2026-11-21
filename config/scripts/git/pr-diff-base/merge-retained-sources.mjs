import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024
  })
  return result.status === 0 ? result.stdout.trimEnd() : null
}

// A merge preserves existing code from both histories, including files retired upstream.
export function resolveRetainedMergeParents(root, comparisonBase) {
  if (
    ['pull_request', 'pull_request_target', 'merge_group'].includes(process.env.GITHUB_EVENT_NAME)
  ) {
    return []
  }
  const base = git(root, ['rev-parse', '--verify', `${comparisonBase}^{commit}`])
  if (!base) {
    return []
  }
  const pending = git(root, ['rev-parse', '--verify', 'MERGE_HEAD'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const trusted = (parents) =>
    parents.filter((parent) => {
      const published = git(root, ['rev-parse', '--verify', 'refs/remotes/fork/main'])
      return (
        published !== null && git(root, ['merge-base', '--is-ancestor', parent, published]) !== null
      )
    })
  if (pending && head === base) {
    return trusted(pending.split(/\s+/).filter((parent) => parent !== base))
  }
  const merges = git(root, ['log', '--first-parent', '--merges', '--format=%P', `${base}..HEAD`])
  for (const line of merges?.split('\n') ?? []) {
    const [first, ...others] = line.split(' ')
    if (first === base) {
      return trusted(others)
    }
  }
  return []
}

function runtimeSource(file, text) {
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
  masked += text.slice(offset)
  try {
    return ts.transpileModule(masked, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        removeComments: false
      }
    }).outputText
  } catch {
    return null
  }
}

export function isRetainedMergeSource(root, file, comparisonBase) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) {
    return false
  }
  // Existing upstream files keep their ordinary ratchet; only restored files qualify.
  if (git(root, ['show', `${comparisonBase}:${file}`]) !== null) {
    return false
  }
  const parents = resolveRetainedMergeParents(root, comparisonBase)
  if (parents.length === 0) {
    return false
  }
  let current
  try {
    current = runtimeSource(file, readFileSync(join(root, file), 'utf8'))
  } catch {
    return false
  }
  if (current === null) {
    return false
  }
  return parents.some((parent) => {
    const previous = git(root, ['show', `${parent}:${file}`])
    return previous !== null && runtimeSource(file, previous) === current
  })
}

export function retainedMergeSourceTexts(root, file, comparisonBase) {
  if (git(root, ['show', `${comparisonBase}:${file}`]) !== null) {
    return []
  }
  return resolveRetainedMergeParents(root, comparisonBase)
    .map((parent) => git(root, ['show', `${parent}:${file}`]))
    .filter((source) => source !== null)
}
