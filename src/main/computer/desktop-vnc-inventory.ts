import { listRegisteredSshTargets } from '../ssh/ssh-target-registry'
import { mintDesktopVncTicket, type DesktopVncTicketTarget } from './desktop-vnc-tickets'
import {
  listDesktopVncTargets,
  resolveDesktopVncTarget,
  readDesktopVncTargetPassword
} from './desktop-vnc-targets'
import { listSshPreviewVncTargets, resolveSshPreviewVncTarget } from './ssh-preview-policy'
import {
  requireDesktopSshAuthority,
  isDesktopVncTicketCurrent,
  probeDesktopVncTarget,
  readSshDesktopPassword
} from './ssh-desktop-vnc-route'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'

function remoteTicketTarget(desktopId: string): DesktopVncTicketTarget {
  const target = resolveSshPreviewVncTarget(desktopId)
  return {
    id: desktopId,
    port: target.port,
    viewOnly: target.viewOnly,
    ssh: {
      authority: requireDesktopSshAuthority(target.targetId),
      policyFingerprint: target.policyFingerprint
    }
  }
}

export async function listExecutionDesktopVncTargets() {
  const local = await mapWithConcurrency(listDesktopVncTargets(), 4, async (summary) =>
    (await probeDesktopVncTarget(resolveDesktopVncTarget(summary.id))) ? summary : null
  )
  const labels = new Map(listRegisteredSshTargets().map((host) => [host.id, host.label]))
  const unavailableHosts = new Set<string>()
  const remote = await mapWithConcurrency(listSshPreviewVncTargets(), 4, async (target) => {
    try {
      const ticketTarget = remoteTicketTarget(target.desktopId)
      if (!(await probeDesktopVncTarget(ticketTarget))) {
        unavailableHosts.add(target.targetId)
        return null
      }
      return {
        id: target.desktopId,
        label: `${labels.get(target.targetId) ?? target.targetId} · ${target.label}`,
        viewOnly: target.viewOnly,
        executionHostId: target.targetId
      }
    } catch {
      unavailableHosts.add(target.targetId)
      return null
    }
  })
  return {
    targets: [...local, ...remote].filter((target) => target !== null),
    unavailableHosts: [...unavailableHosts]
  }
}

export async function createDesktopVncStreamTicket(desktopId?: string) {
  let target: DesktopVncTicketTarget
  let password: string | undefined
  if (desktopId?.startsWith('ssh-vnc:')) {
    target = remoteTicketTarget(desktopId)
    const approved = resolveSshPreviewVncTarget(desktopId)
    if (!target.ssh) {
      throw new Error('Desktop SSH authority is missing')
    }
    password = await readSshDesktopPassword(approved, target.ssh.authority)
    if (!isDesktopVncTicketCurrent(target)) {
      throw new Error('Desktop preview authority expired')
    }
  } else {
    const local = resolveDesktopVncTarget(desktopId)
    target = { id: local.id, port: local.port, viewOnly: local.viewOnly }
    password = readDesktopVncTargetPassword(local)
  }
  const ticket = mintDesktopVncTicket(target)
  return {
    path: `/desktop-vnc?ticket=${encodeURIComponent(ticket)}`,
    desktopId: target.id,
    viewOnly: target.viewOnly,
    ...(password ? { credentials: { password } } : {})
  }
}
