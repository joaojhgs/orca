import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import {
  collectAddedLineRanges,
  collectBaseLineBlocks,
  diagnosticTouchesAddedLines
} from './check-changed-code-quality.mjs'
import { collectBaseSources } from './changed-code-baseline-sources.mjs'
import { createExistingTypeAssertionMatcher } from '../../static-analysis/type-assertion-budget/existing-type-assertions.mjs'

describe('changed-code quality line matching', () => {
  it.each(['edit', 'rename'])('treats bracketed filenames literally after %s', (change) => {
    const repo = mkdtempSync(path.join(tmpdir(), 'changed-code-quality-literal-'))
    try {
      const hooks = `core.hooksPath=${path.join(repo, '.git', 'no-hooks')}`
      const git = (...args) => {
        const result = runProcessSync({
          program: 'git',
          args: ['-c', 'commit.gpgsign=false', '-c', hooks, ...args],
          cwd: repo
        })
        expect(result.code, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      git('init', '--quiet')
      const file = '[cd].ts'
      const source = change === 'rename' ? '[ab].ts' : file
      const content = 'export const first = 1\n\nexport const legacy = 3\n'
      writeFileSync(path.join(repo, source), content)
      writeFileSync(path.join(repo, 'c.ts'), content)
      git('add', '.')
      git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base')
      const base = git('rev-parse', 'HEAD')
      if (change === 'rename') {
        git('mv', source, file)
      }
      writeFileSync(path.join(repo, file), content.replace('first = 1', 'first = 2'))
      writeFileSync(path.join(repo, 'c.ts'), content.replace('legacy = 3', 'legacy = 4'))

      const { rangesByFile } = collectAddedLineRanges(repo, base)
      expect(rangesByFile.get(file)).toEqual([{ start: 1, end: 1 }])
      expect(rangesByFile.get('c.ts')).toEqual([{ start: 3, end: 3 }])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('moved-code exemption', () => {
  it('reads the base text of a file that was renamed away', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'changed-code-quality-rename-'))
    try {
      const git = (...args) => {
        const result = runProcessSync({
          program: 'git',
          args: ['-c', 'commit.gpgsign=false', ...args],
          cwd: repo
        })
        expect(result.code, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      git('init', '--quiet')
      writeFileSync(path.join(repo, 'old.ts'), 'const moved = value as Thing\n')
      git('add', 'old.ts')
      git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base')
      const base = git('rev-parse', 'HEAD')
      git('mv', 'old.ts', 'new.ts')

      expect(collectBaseLineBlocks(repo, base)).toEqual([['const moved = value as Thing']])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('recognizes inherited assertions without exempting assertions added during a merge', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'changed-code-quality-merge-'))
    vi.stubEnv('GITHUB_EVENT_NAME', '')
    try {
      const git = (...args) => {
        const result = runProcessSync({
          program: 'git',
          args: [
            '-c',
            'user.name=t',
            '-c',
            'user.email=t@example.invalid',
            '-c',
            'commit.gpgsign=false',
            ...args
          ],
          cwd: repo
        })
        expect(result.code, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      git('init', '--quiet')
      git('commit', '--allow-empty', '-qm', 'upstream')
      const base = git('rev-parse', 'HEAD')
      git('checkout', '-qb', 'fork')
      writeFileSync(path.join(repo, 'restored.ts'), 'const retained = value as Thing\n')
      git('add', 'restored.ts')
      git('commit', '-qm', 'fork code')
      git('update-ref', 'refs/remotes/fork/main', 'HEAD')
      git('checkout', '-q', '--detach', base)
      git('merge', '-q', '--no-commit', '--no-ff', 'fork')

      const file = 'resolution.ts'
      const content = 'const moved = value as Thing\nconst fresh = value as Other\n'
      writeFileSync(path.join(repo, file), content)
      git('add', file)
      const { rangesByFile } = collectAddedLineRanges(repo, base)
      const touchesAddedLines = (fragment, line, baseline) => {
        const diagnostic = {
          filename: file,
          code: 'typescript(consistent-type-assertions)',
          labels: [{ span: { line, offset: content.indexOf(fragment), length: fragment.length } }]
        }
        return diagnosticTouchesAddedLines(diagnostic, rangesByFile, repo, [], undefined, baseline)
      }
      const baseline = createExistingTypeAssertionMatcher(collectBaseSources(repo, base))
      expect(touchesAddedLines('value as Thing', 1, baseline)).toBe(false)
      expect(touchesAddedLines('value as Other', 2, baseline)).toBe(true)

      vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request')
      const prBaseline = createExistingTypeAssertionMatcher(collectBaseSources(repo, base))
      expect(touchesAddedLines('value as Thing', 1, prBaseline)).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('reads filenames containing newlines', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'changed-code-quality-newline-'))
    try {
      const git = (...args) => {
        const result = runProcessSync({ program: 'git', args, cwd: repo })
        expect(result.code, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      git('init', '--quiet')
      const file = 'line\nbreak.ts'
      writeFileSync(path.join(repo, file), 'const kept = true\n')
      git('add', '--all')
      git(
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        'commit',
        '-qm',
        'base'
      )
      expect(collectBaseLineBlocks(repo, git('rev-parse', 'HEAD'), [file])).toEqual([
        ['const kept = true']
      ])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
