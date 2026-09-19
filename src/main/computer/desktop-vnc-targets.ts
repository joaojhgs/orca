import { existsSync, readFileSync, statSync, type Stats } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { app } from 'electron'

export type DesktopVncTarget = Readonly<{
  id: string
  label: string
  port: number
  viewOnly: boolean
  passwordFile?: string
}>

export type DesktopVncTargetSummary = Readonly<{
  id: string
  label: string
  viewOnly: boolean
}>

const CONFIG_FILE_NAME = 'desktop-vnc-targets.json'
const MAIN_TARGET: DesktopVncTarget = {
  id: 'main',
  label: 'Main desktop',
  port: 5900,
  viewOnly: false
}
const MAX_CONFIG_BYTES = 64 * 1024
const MAX_PASSWORD_BYTES = 4 * 1024
const MAX_CONFIG_TARGETS = 16
const TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export function listDesktopVncTargets(userDataPath = getUserDataPath()): DesktopVncTargetSummary[] {
  return [MAIN_TARGET, ...readConfiguredTargets(userDataPath)].map(({ id, label, viewOnly }) => ({
    id,
    label,
    viewOnly
  }))
}

export function resolveDesktopVncTarget(
  desktopId = MAIN_TARGET.id,
  userDataPath = getUserDataPath()
): DesktopVncTarget {
  const targets = [MAIN_TARGET, ...readConfiguredTargets(userDataPath)]
  const target = targets.find((candidate) => candidate.id === desktopId)
  if (!target) {
    throw new Error('Unknown desktop VNC target')
  }
  return target
}

export function readDesktopVncTargetPassword(target: DesktopVncTarget): string | undefined {
  if (!target.passwordFile) {
    return undefined
  }
  return readPasswordFileContent(target.passwordFile)
}

function readConfiguredTargets(userDataPath: string): DesktopVncTarget[] {
  const configPath = join(userDataPath, CONFIG_FILE_NAME)
  if (!existsSync(configPath)) {
    return []
  }
  const size = statSync(configPath).size
  if (size > MAX_CONFIG_BYTES) {
    throw invalidConfig('file is too large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    throw invalidConfig('file is not valid JSON')
  }
  return parseTargets(parsed)
}

function parseTargets(parsed: unknown): DesktopVncTarget[] {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.targets)) {
    throw invalidConfig('expected an object with a targets array')
  }
  if (parsed.targets.length > MAX_CONFIG_TARGETS) {
    throw invalidConfig('too many targets')
  }
  const ids = new Set<string>([MAIN_TARGET.id])
  return parsed.targets.map((target) => parseTarget(target, ids))
}

function parseTarget(target: unknown, ids: Set<string>): DesktopVncTarget {
  if (!isPlainObject(target)) {
    throw invalidConfig('target must be an object')
  }
  const id = readId(target.id, ids)
  const label = readLabel(target.label)
  const port = readPort(target.port)
  const viewOnly = readViewOnly(target.viewOnly)
  const passwordFile = readPasswordFile(target.passwordFile)
  return passwordFile ? { id, label, port, viewOnly, passwordFile } : { id, label, port, viewOnly }
}

function readId(value: unknown, ids: Set<string>): string {
  if (typeof value !== 'string' || !TARGET_ID_PATTERN.test(value)) {
    throw invalidConfig('target id is invalid')
  }
  if (ids.has(value)) {
    throw invalidConfig('target id is duplicated')
  }
  ids.add(value)
  return value
}

function readLabel(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidConfig('target label is invalid')
  }
  const label = value.trim()
  if (label.length === 0 || label.length > 80) {
    throw invalidConfig('target label is invalid')
  }
  return label
}

function readPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw invalidConfig('target port is invalid')
  }
  return value
}

function readViewOnly(value: unknown): boolean {
  if (value !== true) {
    throw invalidConfig('configured targets must be view-only')
  }
  return value
}

function readPasswordFile(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096) {
    throw invalidConfig('target password file is invalid')
  }
  return value
}

function readPasswordFileContent(passwordFile: string): string {
  try {
    const stats = statSync(passwordFile)
    assertRegularBoundedPasswordFile(stats)
    const buffer = readFileSync(passwordFile)
    if (buffer.byteLength > MAX_PASSWORD_BYTES) {
      throw passwordFileError('file is too large')
    }
    const password = trimOneTrailingNewline(buffer.toString('utf8'))
    if (password.length === 0) {
      throw passwordFileError('file is empty')
    }
    return password
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid desktop VNC target password:')) {
      throw error
    }
    throw passwordFileError('file is unavailable')
  }
}

function assertRegularBoundedPasswordFile(stats: Stats): void {
  if (!stats.isFile()) {
    throw passwordFileError('path is not a regular file')
  }
  if (stats.size > MAX_PASSWORD_BYTES) {
    throw passwordFileError('file is too large')
  }
}

function trimOneTrailingNewline(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2)
  }
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getUserDataPath(): string {
  return app.getPath('userData')
}

function invalidConfig(reason: string): Error {
  return new Error(`Invalid desktop VNC target configuration: ${reason}`)
}

function passwordFileError(reason: string): Error {
  return new Error(`Invalid desktop VNC target password: ${reason}`)
}
