import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { runProcessSync } from '@orca/process-host'
import { resolveRetainedMergeParents } from '../../git/pr-diff-base/merge-retained-sources.mjs'

export const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/

function gitDiffPaths(root, base, args) {
  return execFileSync('git', ['diff', ...args, '-z', base, '--'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter(Boolean)
}

function readBaseSourceBatch(root, comparisonBase, files) {
  // Git 2.25 supports --batch; its newline protocol cannot represent newline paths.
  if (files.some((file) => /[\r\n]/.test(`${comparisonBase}:${file}`))) {
    return null
  }
  try {
    const result = runProcessSync({
      program: 'git',
      args: ['cat-file', '--batch'],
      cwd: root,
      input: files.map((file) => `${comparisonBase}:${file}\n`).join(''),
      captureStdoutAsBytes: true,
      maxOutputBytes: 64 * 1024 * 1024,
      timeoutMs: null
    })
    if (result.code !== 0 || !result.stdoutBytes) {
      return null
    }
    const output = result.stdoutBytes
    const sources = []
    let offset = 0
    for (const file of files) {
      const end = output.indexOf(10, offset)
      if (end === -1) {
        return null
      }
      const header = output.subarray(offset, end).toString('utf8')
      offset = end + 1
      if (header === `${comparisonBase}:${file} missing`) {
        continue
      }
      const match = /^[0-9a-f]{40}(?:[0-9a-f]{24})? blob (\d+)$/.exec(header)
      if (!match) {
        return null
      }
      const size = Number(match[1])
      if (!Number.isSafeInteger(size) || output[offset + size] !== 10) {
        return null
      }
      sources.push({ file, source: output.subarray(offset, offset + size).toString('utf8') })
      offset += size + 1
    }
    return offset === output.length ? sources : null
  } catch {
    // Preserve per-file reads when a batch exceeds the output limit or cannot run.
    return null
  }
}

function readBaseSources(root, comparisonBase, paths) {
  const records = []
  for (let start = 0; start < paths.length; start += 32) {
    const batch = paths.slice(start, start + 32)
    let sources = readBaseSourceBatch(root, comparisonBase, batch)
    if (sources === null) {
      sources = []
      for (const file of batch) {
        try {
          const result = runProcessSync({
            program: 'git',
            args: ['show', `${comparisonBase}:${file}`],
            cwd: root,
            maxOutputBytes: 64 * 1024 * 1024,
            timeoutMs: null
          })
          if (result.code === 0) {
            sources.push({ file, source: result.stdout })
          }
        } catch {
          // Failed source reads were already skipped by the per-file implementation.
          continue
        }
      }
    }
    records.push(...sources)
  }
  return records
}

function listTouchedSourcePaths(root, base) {
  // Include deletions so the gate can find code that moved away from its original path.
  return gitDiffPaths(root, base, ['--name-only', '--no-renames']).filter((file) =>
    SOURCE_FILE_PATTERN.test(file)
  )
}

function listRetainedSourcePaths(root, parent, paths) {
  const retainedPaths = new Set(paths)
  const changedNames = new Set(paths.map((file) => path.posix.basename(file)))
  const entries = gitDiffPaths(root, parent, [
    '--name-status',
    '--find-renames',
    '--diff-filter=DR'
  ])
  for (let index = 0; index < entries.length;) {
    const status = entries[index++]
    const source = entries[index++]
    if (status.startsWith('R')) {
      const destination = entries[index++]
      if (retainedPaths.has(destination)) {
        retainedPaths.add(source)
      }
    } else if (changedNames.has(path.posix.basename(source))) {
      // Large restructures can hit Git's rename detection limit for moved, edited files.
      retainedPaths.add(source)
    }
  }
  return [...retainedPaths]
}

export function collectBaseSources(root, comparisonBase, files = null) {
  const paths = files ?? listTouchedSourcePaths(root, comparisonBase)
  const sources = readBaseSources(root, comparisonBase, paths)
  for (const parent of resolveRetainedMergeParents(root, comparisonBase)) {
    // A path can be added against the comparison base yet unchanged against this parent.
    const parentPaths = files ?? listRetainedSourcePaths(root, parent, paths)
    for (const source of readBaseSources(root, parent, parentPaths)) {
      sources.push(source)
    }
  }
  return sources
}
