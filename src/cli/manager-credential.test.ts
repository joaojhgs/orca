import { mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readManagerCredential, readOptionalManagerCredential } from './manager-credential'

const paths: string[] = []
const token = `orcam_${'x'.repeat(43)}`
function file() {
  const root = mkdtempSync(join(tmpdir(), 'orca-manager-credential-'))
  paths.push(root)
  const path = join(root, 'credential.json')
  writeFileSync(path, JSON.stringify({ serviceToken: token }), { mode: 0o600 })
  return { path, root }
}
afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
describe('private manager credential source', () => {
  it('only falls back to ordinary transport auth when no manager source was configured', () => {
    expect(readOptionalManagerCredential({})).toBeNull()
    expect(readOptionalManagerCredential({ ORCA_MANAGER_TOKEN: token })).toBe(token)
    expect(() => readOptionalManagerCredential({ ORCA_MANAGER_TOKEN: '' })).toThrow()
    expect(() => readOptionalManagerCredential({ ORCA_MANAGER_CREDENTIAL_FILE: '' })).toThrow()
  })
  it('accepts one explicit credential source and refuses missing or ambiguous sources', () => {
    expect(readManagerCredential({ ORCA_MANAGER_TOKEN: token })).toBe(token)
    expect(() => readManagerCredential({})).toThrow(/not configured/)
    expect(() =>
      readManagerCredential({ ORCA_MANAGER_TOKEN: token, ORCA_MANAGER_CREDENTIAL_FILE: 'path' })
    ).toThrow(/one manager/)
  })
  it('reads a caller-owned private file without printing its contents', () => {
    expect(readManagerCredential({ ORCA_MANAGER_CREDENTIAL_FILE: file().path })).toBe(token)
  })
  it.skipIf(process.platform === 'win32')(
    'refuses group/world-readable credentials and symlink substitution',
    () => {
      const { root, path } = file()
      const link = join(root, 'link')
      symlinkSync(path, link)
      expect(() => readManagerCredential({ ORCA_MANAGER_CREDENTIAL_FILE: link })).toThrow()
      chmodSync(path, 0o644)
      expect(() => readManagerCredential({ ORCA_MANAGER_CREDENTIAL_FILE: path })).toThrow(/private/)
    }
  )
  it('rejects oversized and invalid credentials', () => {
    const { path } = file()
    writeFileSync(path, 'x'.repeat(20_000))
    expect(() => readManagerCredential({ ORCA_MANAGER_CREDENTIAL_FILE: path })).toThrow(/private/)
    expect(() => readManagerCredential({ ORCA_MANAGER_TOKEN: 'owner-token' })).toThrow()
  })
})
