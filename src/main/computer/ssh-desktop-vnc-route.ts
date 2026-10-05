import { connect } from 'node:net'
import type { DirectSshAuthority } from '../../shared/ssh-types'
import { resolveBrowserNetworkExecutionRoute } from '../browser/browser-network-execution-route-dispatch'
import type { BrowserNetworkExecutionRoute } from '../browser/browser-network-execution-route'
import type { BrowserNetworkTunnelSocket } from '../browser/browser-network-tunnel-stream-state'
import { getSshConnectionManager } from '../ssh/ssh-target-registry'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority
} from '../ssh/ssh-provider-authority'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { resolveSshPreviewVncTarget, type SshPreviewVncTarget } from './ssh-preview-policy'
import type { DesktopVncTicketTarget } from './desktop-vnc-tickets'

export function requireDesktopSshAuthority(targetId: string): DirectSshAuthority {
  const connection = getSshConnectionManager()?.getConnection(targetId)
  if (connection?.getState().status !== 'connected') {
    throw new Error('Desktop SSH connection is unavailable. Reconnect its host.')
  }
  return getSshProviderAuthority(targetId)
}

export function isDesktopVncTicketCurrent(target: DesktopVncTicketTarget): boolean {
  if (!target.ssh) {
    return true
  }
  try {
    const policy = resolveSshPreviewVncTarget(target.id)
    return (
      policy.policyFingerprint === target.ssh.policyFingerprint &&
      policy.port === target.port &&
      policy.viewOnly === target.viewOnly &&
      policy.targetId === target.ssh.authority.targetId &&
      isCurrentSshProviderAuthority(target.ssh.authority) &&
      getSshConnectionManager()?.getConnection(policy.targetId)?.getState().status === 'connected'
    )
  } catch {
    return false
  }
}

type DesktopVncChannel = {
  socket: BrowserNetworkTunnelSocket
  close: () => void | Promise<void>
  whenInvalidated?: Promise<void>
}
export async function openDesktopVncRoute(
  target: DesktopVncTicketTarget,
  signal?: AbortSignal
): Promise<DesktopVncChannel> {
  if (!target.ssh) {
    return { socket: connect(target.port, '127.0.0.1'), close: () => {} }
  }
  if (!isDesktopVncTicketCurrent(target)) {
    throw new Error('Desktop preview authority expired')
  }
  const route = await openDesktopSshRoute(target.ssh.authority, signal)
  if (!isDesktopVncTicketCurrent(target) || !route.isValid()) {
    await route.close()
    throw new Error('Desktop preview authority expired')
  }
  const socket = route.connect({ host: '127.0.0.1', port: target.port })
  // Deferred SSH failures may fire before the async caller attaches its listeners.
  socket.on('error', () => {})
  return {
    socket,
    close: () => route.close(),
    whenInvalidated: route.whenInvalidated
  }
}

export function openDesktopSshRoute(
  authority: DirectSshAuthority,
  signal?: AbortSignal
): Promise<BrowserNetworkExecutionRoute> {
  return resolveBrowserNetworkExecutionRoute({
    executionHost: { kind: 'ssh', ...authority },
    runtimeId: 'ssh-preview',
    runtimeRevision: 1,
    signal
  })
}

export async function readSshDesktopPassword(
  target: SshPreviewVncTarget,
  authority: DirectSshAuthority
) {
  if (!target.passwordFile) {
    return undefined
  }
  try {
    const provider = requireSshFilesystemProvider(target.targetId)
    const stat = await provider.stat(target.passwordFile)
    if (stat.type !== 'file' || stat.size > 4096 || !provider.readFileRange) {
      throw new Error('unavailable')
    }
    const result = await provider.readFileRange(target.passwordFile, 0, 4097)
    if (!isCurrentSshProviderAuthority(authority) || result.bytes.length > 4096) {
      throw new Error('unavailable')
    }
    const password = result.bytes.toString('utf8').replace(/\r?\n$/, '')
    if (!password) {
      throw new Error('empty')
    }
    return password
  } catch {
    throw new Error('Desktop VNC password is unavailable on its SSH host')
  }
}

export async function probeDesktopVncTarget(target: DesktopVncTicketTarget): Promise<boolean> {
  const abort = new AbortController()
  let channel: Awaited<ReturnType<typeof openDesktopVncRoute>> | undefined
  return new Promise<boolean>((resolve) => {
    let done = false
    let banner = Buffer.alloc(0)
    const finish = (live: boolean) => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timer)
      abort.abort()
      channel?.socket.destroy()
      void channel?.close()
      resolve(live)
    }
    const timer = setTimeout(() => finish(false), 4000)
    void openDesktopVncRoute(target, abort.signal)
      .then((opened) => {
        channel = opened
        if (done) {
          opened.socket.destroy()
          void opened.close()
          return
        }
        if (opened.socket.destroyed) {
          finish(false)
          return
        }
        opened.socket.on('error', () => finish(false)).on('close', () => finish(false))
        opened.socket.on('data', (bytes) => {
          banner = Buffer.concat([banner, Buffer.from(bytes).subarray(0, 12 - banner.length)])
          if (banner.length === 12) {
            finish(/^RFB 003\.\d{3}\n$/.test(banner.toString('ascii')))
          }
        })
        void opened.whenInvalidated?.then(() => finish(false))
      })
      .catch(() => finish(false))
  })
}
