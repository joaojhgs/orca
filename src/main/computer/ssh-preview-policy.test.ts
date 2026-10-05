import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readSshPreviewPolicy,
  listSshPreviewVncTargets,
  resolveSshPreviewVncTarget
} from './ssh-preview-policy'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

let dir = ''
const host = {
  targetId: 'personal',
  vnc: [{ id: 'main', label: 'Desktop', port: 5900, viewOnly: false }]
}
function write(value: unknown) {
  writeFileSync(join(dir, 'ssh-preview-policy.json'), JSON.stringify(value))
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-preview-policy-'))
  installFakeAppEnvironment({ getPath: () => dir })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SSH preview operator policy', () => {
  it('grants no remote preview access by default', () => {
    expect(listSshPreviewVncTargets()).toEqual([])
    expect(() => resolveSshPreviewVncTarget('ssh-vnc:forged')).toThrow(/not approved/)
  })
  it('issues stable opaque IDs but changes the revocation fingerprint', () => {
    write({ hosts: [host] })
    const first = listSshPreviewVncTargets()[0]
    expect(resolveSshPreviewVncTarget(first.desktopId)).toEqual(first)
    write({ hosts: [{ ...host, vnc: [{ ...host.vnc[0], port: 5901 }] }] })
    const next = listSshPreviewVncTargets()[0]
    expect(next.desktopId).toBe(first.desktopId)
    expect(next.policyFingerprint).not.toBe(first.policyFingerprint)
  })
  it('rejects arbitrary addresses, duplicate hosts/targets and invalid ports', () => {
    for (const value of [
      { hosts: [host, host] },
      { hosts: [{ ...host, vnc: [host.vnc[0], host.vnc[0]] }] },
      { hosts: [{ ...host, vnc: [{ ...host.vnc[0], hostname: '10.0.0.1' }] }] },
      { hosts: [{ ...host, vnc: [{ ...host.vnc[0], port: 0 }] }] }
    ]) {
      write(value)
      expect(() => readSshPreviewPolicy()).toThrow()
    }
  })
  it('requires explicit USB, emulator or serial approval for ADB', () => {
    write({ hosts: [{ ...host, adb: {} }] })
    expect(readSshPreviewPolicy().hosts[0].adb).toEqual({
      usb: false,
      emulators: false,
      serials: []
    })
  })
})
