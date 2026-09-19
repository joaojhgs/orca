import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listDesktopVncTargets,
  readDesktopVncTargetPassword,
  resolveDesktopVncTarget
} from './desktop-vnc-targets'

const tempDirs: string[] = []

describe('desktop VNC targets', () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('exposes the main desktop when no target config exists', () => {
    const userDataPath = createTempDir()

    expect(listDesktopVncTargets(userDataPath)).toEqual([
      { id: 'main', label: 'Main desktop', viewOnly: false }
    ])
    expect(resolveDesktopVncTarget(undefined, userDataPath)).toMatchObject({
      id: 'main',
      port: 5900,
      viewOnly: false
    })
  })

  it('loads extra view-only loopback targets without exposing secrets', () => {
    const userDataPath = createTempDir()
    const passwordFile = join(userDataPath, 'game-vnc-password')
    writeFileSync(passwordFile, 'swordfish\n')
    writeTargets(userDataPath, {
      targets: [
        {
          id: 'game',
          label: 'K-style game desktop',
          port: 5901,
          viewOnly: true,
          passwordFile
        }
      ]
    })

    expect(listDesktopVncTargets(userDataPath)).toEqual([
      { id: 'main', label: 'Main desktop', viewOnly: false },
      { id: 'game', label: 'K-style game desktop', viewOnly: true }
    ])
    const target = resolveDesktopVncTarget('game', userDataPath)
    expect(target).toMatchObject({ id: 'game', port: 5901, viewOnly: true })
    expect(readDesktopVncTargetPassword(target)).toBe('swordfish')
  })

  it('rejects attempts to override main or create interactive extra targets', () => {
    const userDataPath = createTempDir()
    writeTargets(userDataPath, {
      targets: [{ id: 'main', label: 'Second main', port: 5901, viewOnly: true }]
    })
    expect(() => listDesktopVncTargets(userDataPath)).toThrow(/duplicated/)

    const otherUserDataPath = createTempDir()
    writeTargets(otherUserDataPath, {
      targets: [{ id: 'game', label: 'Game', port: 5901, viewOnly: false }]
    })
    expect(() => listDesktopVncTargets(otherUserDataPath)).toThrow(/view-only/)
  })

  it('rejects unknown targets instead of falling back', () => {
    expect(() => resolveDesktopVncTarget('missing', createTempDir())).toThrow(
      /Unknown desktop VNC target/
    )
  })

  it('rejects missing password files without exposing the path', () => {
    const userDataPath = createTempDir()
    const passwordFile = join(userDataPath, 'missing-password')
    writeTargets(userDataPath, {
      targets: [{ id: 'game', label: 'Game', port: 5901, viewOnly: true, passwordFile }]
    })

    const target = resolveDesktopVncTarget('game', userDataPath)
    expect(() => readDesktopVncTargetPassword(target)).toThrow(
      /^Invalid desktop VNC target password: file is unavailable$/
    )
    expect(() => readDesktopVncTargetPassword(target)).not.toThrow(passwordFile)
  })

  it('rejects directory password files before reading content', () => {
    const userDataPath = createTempDir()
    const passwordFile = join(userDataPath, 'password-dir')
    mkdirSync(passwordFile)
    writeTargets(userDataPath, {
      targets: [{ id: 'game', label: 'Game', port: 5901, viewOnly: true, passwordFile }]
    })

    const target = resolveDesktopVncTarget('game', userDataPath)
    expect(() => readDesktopVncTargetPassword(target)).toThrow(
      /^Invalid desktop VNC target password: path is not a regular file$/
    )
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-desktop-vnc-targets-'))
  tempDirs.push(dir)
  return dir
}

function writeTargets(userDataPath: string, value: unknown): void {
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(join(userDataPath, 'desktop-vnc-targets.json'), JSON.stringify(value))
}
