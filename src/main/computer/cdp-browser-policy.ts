import { EventEmitter } from 'node:events'
import { readSshPreviewPolicy } from './ssh-preview-policy'
import { requireDesktopSshAuthority } from './ssh-desktop-vnc-route'
import { isCurrentSshProviderAuthority } from '../ssh/connection/authority/ssh-provider-authority'
import type { CdpBrowserTarget } from '../../shared/cdp-relay-contract'

const controls = new Map<string, { humanControl: boolean; revision: number }>()
export const cdpControlEvents = new EventEmitter()
cdpControlEvents.setMaxListeners(32)

export function cdpControl(id: string) {
  return controls.get(id) ?? { humanControl: false, revision: 0 }
}

export function approvedCdpBrowsers() {
  const policy = readSshPreviewPolicy()
  return policy.hosts.flatMap((host) =>
    (host.cdp ?? []).map((browser) => ({
      ...browser,
      targetId: host.targetId,
      fingerprint: policy.fingerprint,
      publicOrigin: policy.cdpPublicOrigin,
      browserId: `ssh-cdp:${Buffer.from(JSON.stringify([host.targetId, browser.id])).toString('base64url')}`,
      desktopId: `ssh-vnc:${Buffer.from(JSON.stringify([host.targetId, browser.vncId])).toString('base64url')}`
    }))
  )
}

export function resolveCdpBrowser(id: string) {
  const target = approvedCdpBrowsers().find((row) => row.browserId === id)
  if (!target) {
    throw new Error('Browser is not approved for CDP relay')
  }
  const authority = requireDesktopSshAuthority(target.targetId)
  return { ...target, authority, revision: cdpControl(id).revision }
}
export type ApprovedCdpBrowser = ReturnType<typeof resolveCdpBrowser>

export function cdpBrowserIsCurrent(target: ApprovedCdpBrowser): boolean {
  try {
    const current = resolveCdpBrowser(target.browserId)
    return (
      current.fingerprint === target.fingerprint &&
      current.port === target.port &&
      current.revision === target.revision &&
      !cdpControl(target.browserId).humanControl &&
      isCurrentSshProviderAuthority(target.authority)
    )
  } catch {
    return false
  }
}

export function setCdpHumanControl(id: string, humanControl: boolean) {
  resolveCdpBrowser(id)
  const previous = cdpControl(id)
  controls.set(id, { humanControl, revision: previous.revision + 1 })
  cdpControlEvents.emit('change', id)
  return { browserId: id, humanControl }
}

export function listCdpBrowserTargets(): { targets: CdpBrowserTarget[] } {
  return {
    targets: approvedCdpBrowsers().flatMap((target) => {
      try {
        requireDesktopSshAuthority(target.targetId)
        return [
          {
            id: target.browserId,
            label: target.label,
            desktopId: target.desktopId,
            executionHostId: `ssh:${target.targetId}`,
            humanControl: cdpControl(target.browserId).humanControl
          }
        ]
      } catch {
        return []
      }
    })
  }
}
