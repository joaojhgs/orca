import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

type GitDirState = {
  /** Each git dir's HEAD file, keyed by git dir. */
  heads: ReadonlyMap<string, string>
  /** Branches a rebase (head-name, --update-refs) or bisect reserves: Git's own in-use rule. */
  reserved: ReadonlySet<string>
}

// Reads files only: this runs inside an admitted command, where running Git could wait on its own slot.
export async function readGitDirState(commonDir: string): Promise<GitDirState> {
  // Fail closed: an unreadable common dir must not look like "nothing in use".
  if (!(await stat(commonDir)).isDirectory()) {
    throw new Error(`${commonDir} is not a Git directory`)
  }
  const gitDirs = [commonDir]
  try {
    for (const entry of await readdir(join(commonDir, 'worktrees'), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        gitDirs.push(join(commonDir, 'worktrees', entry.name))
      }
    }
  } catch (error) {
    rethrowUnlessMissing(error)
  }
  const heads = new Map<string, string>()
  const reserved = new Set<string>()
  await Promise.all(
    gitDirs.map(async (gitDir) => {
      const [head, rebaseMerge, rebaseApply, updateRefs, bisectStart] = await Promise.all([
        readOptional(join(gitDir, 'HEAD')),
        readOptional(join(gitDir, 'rebase-merge', 'head-name')),
        readOptional(join(gitDir, 'rebase-apply', 'head-name')),
        readOptional(join(gitDir, 'rebase-merge', 'update-refs')),
        readOptional(join(gitDir, 'BISECT_START'))
      ])
      heads.set(gitDir, head.trim())
      for (const line of [rebaseMerge, rebaseApply, updateRefs].flatMap((text) =>
        text.split('\n')
      )) {
        if (line.startsWith('refs/heads/')) {
          reserved.add(line.trim())
        }
      }
      const bisected = bisectStart.trim()
      if (bisected) {
        reserved.add(bisected.startsWith('refs/') ? bisected : `refs/heads/${bisected}`)
      }
    })
  )
  return { heads, reserved }
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    rethrowUnlessMissing(error)
    return ''
  }
}

function rethrowUnlessMissing(error: unknown): void {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code !== 'ENOENT' && code !== 'ENOTDIR') {
    throw error
  }
}

export async function isGitBranchInUse(
  commonDir: string,
  fullRef: string,
  bareCommonDir: boolean
): Promise<boolean> {
  const { heads, reserved } = await readGitDirState(commonDir)
  return (
    reserved.has(fullRef) ||
    [...heads].some(
      ([gitDir, head]) =>
        !(bareCommonDir && gitDir === commonDir) &&
        // Reftable keeps HEAD elsewhere and leaves this placeholder: fail closed.
        (head === `ref: ${fullRef}` || head === 'ref: refs/heads/.invalid')
    )
  )
}
