import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRelayLaunchOptions, readRelayEndpointCredential } from './relay-launch-options'

describe('relay launch options', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  it('preserves daemon mode flags and grace seconds conversion', () => {
    expect(
      parseRelayLaunchOptions([
        'node',
        'relay.js',
        '--detached',
        '--connect',
        '--grace-time',
        '17',
        '--sock-path',
        'relay-endpoint',
        '--endpoint-dir',
        'hooks',
        '--log-file',
        'relay.log',
        '--credential-file',
        'relay.credential'
      ])
    ).toEqual({
      graceTimeMs: 17_000,
      connectMode: true,
      detached: true,
      cliMode: false,
      sockPath: 'relay-endpoint',
      endpointDir: 'hooks',
      logFile: 'relay.log',
      credentialFile: 'relay.credential'
    })
  })

  it('reads the bundled ripgrep path, which older launch commands omit', () => {
    expect(
      parseRelayLaunchOptions([
        'node',
        'relay.js',
        '--detached',
        '--ripgrep-path',
        '/home/me/.orca-remote/ripgrep/c0ffee0123456789-linux-x64/rg'
      ]).ripgrepPath
    ).toBe('/home/me/.orca-remote/ripgrep/c0ffee0123456789-linux-x64/rg')
    expect(parseRelayLaunchOptions(['node', 'relay.js', '--detached']).ripgrepPath).toBe(undefined)
  })

  it('keeps zero grace unlimited and ignores invalid replacements', () => {
    expect(
      parseRelayLaunchOptions(['node', 'relay.js', '--grace-time', '0', '--grace-time', '-1'])
        .graceTimeMs
    ).toBe(0)
  })

  it('reads an owner-only endpoint credential without rewriting its permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-launch-options-'))
    temporaryDirectories.push(directory)
    const credentialFile = join(directory, 'endpoint.credential')
    const credential = 'a'.repeat(32)
    writeFileSync(credentialFile, `${credential}\n`, { mode: 0o600 })
    if (process.platform !== 'win32') {
      chmodSync(credentialFile, 0o400)
    }

    expect(readRelayEndpointCredential(credentialFile)).toBe(credential)
    if (process.platform !== 'win32') {
      expect(statSync(credentialFile).mode & 0o777).toBe(0o400)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'rejects shared permissions without repairing them',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'relay-launch-options-'))
      temporaryDirectories.push(directory)
      const credentialFile = join(directory, 'endpoint.credential')
      writeFileSync(credentialFile, 'a'.repeat(32))
      chmodSync(credentialFile, 0o644)

      expect(() => readRelayEndpointCredential(credentialFile)).toThrow('owner-only')
      expect(statSync(credentialFile).mode & 0o777).toBe(0o644)
    }
  )

  it.skipIf(process.platform === 'win32')('rejects credentials owned by another user', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-launch-options-'))
    temporaryDirectories.push(directory)
    const credentialFile = join(directory, 'endpoint.credential')
    writeFileSync(credentialFile, 'a'.repeat(32), { mode: 0o600 })
    vi.spyOn(process, 'getuid').mockReturnValue(statSync(credentialFile).uid + 1)

    expect(() => readRelayEndpointCredential(credentialFile)).toThrow('owned by this user')
  })

  it('does not require a credential when no credential file was supplied', () => {
    expect(readRelayEndpointCredential(undefined)).toBeUndefined()
  })

  it('rejects credentials that cannot authenticate a reconnect client', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-launch-options-'))
    temporaryDirectories.push(directory)
    const credentialFile = join(directory, 'endpoint.credential')
    writeFileSync(credentialFile, 'too-short', { mode: 0o600 })

    expect(() => readRelayEndpointCredential(credentialFile)).toThrow(
      'Relay endpoint credential is missing or invalid'
    )
  })
})
