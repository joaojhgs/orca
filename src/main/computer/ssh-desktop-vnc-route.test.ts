import { connect, createServer, Socket, type Server } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { getSshProviderAuthority, rotateSshProviderAuthority } from '../ssh/ssh-provider-authority'
import { listSshPreviewVncTargets } from './ssh-preview-policy'
import {
  isDesktopVncTicketCurrent,
  openDesktopVncRoute,
  probeDesktopVncTarget,
  readSshDesktopPassword
} from './ssh-desktop-vnc-route'
import type { DesktopVncTicketTarget } from './desktop-vnc-tickets'

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  status: 'connected',
  stat: vi.fn(),
  range: vi.fn()
}))
vi.mock('../browser/browser-network-execution-route-dispatch', () => ({
  resolveBrowserNetworkExecutionRoute: mocks.route
}))
vi.mock('../ssh/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({
    getConnection: () => ({ getState: () => ({ status: mocks.status }) })
  })
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: () => ({ stat: mocks.stat, readFileRange: mocks.range })
}))
let dir = ''
let server: Server | undefined
function policy(port = 5901) {
  writeFileSync(
    join(dir, 'ssh-preview-policy.json'),
    JSON.stringify({
      hosts: [
        {
          targetId: 'personal',
          vnc: [
            { id: 'game', label: 'Game', port, viewOnly: true, passwordFile: '/remote/password' }
          ]
        }
      ]
    })
  )
  const approved = listSshPreviewVncTargets()[0]
  const target: DesktopVncTicketTarget = {
    id: approved.desktopId,
    port,
    viewOnly: true,
    ssh: {
      authority: getSshProviderAuthority('personal'),
      policyFingerprint: approved.policyFingerprint
    }
  }
  return { target, approved }
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-vnc-route-'))
  installFakeAppEnvironment({ getPath: () => dir })
  mocks.status = 'connected'
  mocks.route.mockReset()
  mocks.stat.mockReset()
  mocks.range.mockReset()
})
afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  }
  server = undefined
  rmSync(dir, { recursive: true, force: true })
})
describe('fenced SSH desktop VNC route', () => {
  it('binds to the approved host and loopback port, never controller localhost', async () => {
    const { target } = policy()
    const socket = connect(65534, '127.0.0.1')
    socket.on('error', () => {})
    const dial = vi.fn(() => socket)
    const close = vi.fn()
    mocks.route.mockResolvedValue({ connect: dial, close, isValid: () => true })
    const channel = await openDesktopVncRoute(target)
    expect(mocks.route).toHaveBeenCalledWith(
      expect.objectContaining({ executionHost: { kind: 'ssh', ...target.ssh?.authority } })
    )
    expect(dial).toHaveBeenCalledWith({ host: '127.0.0.1', port: 5901 })
    channel.socket.destroy()
    await channel.close()
    expect(close).toHaveBeenCalled()
  })
  it('rejects ticket port/policy/authority forgery and revocation', async () => {
    const { target } = policy()
    expect(isDesktopVncTicketCurrent(target)).toBe(true)
    expect(isDesktopVncTicketCurrent({ ...target, port: 22 })).toBe(false)
    policy(5902)
    expect(isDesktopVncTicketCurrent(target)).toBe(false)
    await expect(openDesktopVncRoute(target)).rejects.toThrow(/expired/)
    expect(mocks.route).not.toHaveBeenCalled()
    const next = policy().target
    rotateSshProviderAuthority('personal')
    expect(isDesktopVncTicketCurrent(next)).toBe(false)
    mocks.status = 'disconnected'
    expect(isDesktopVncTicketCurrent(policy().target)).toBe(false)
  })
  it('fences password reads and bounds the bytes without leaking the path', async () => {
    const { target, approved } = policy()
    if (!target.ssh) {
      throw new Error('Expected SSH target')
    }
    mocks.stat.mockResolvedValue({ size: 7, type: 'file' })
    mocks.range.mockResolvedValue({ bytes: Buffer.from('secret\n'), bytesRead: 7 })
    await expect(readSshDesktopPassword(approved, target.ssh.authority)).resolves.toBe('secret')
    expect(mocks.range).toHaveBeenCalledWith('/remote/password', 0, 4097)
    mocks.range.mockImplementation(async () => {
      rotateSshProviderAuthority('personal')
      return { bytes: Buffer.from('secret') }
    })
    await expect(readSshDesktopPassword(approved, target.ssh.authority)).rejects.toThrow(
      /^Desktop VNC password is unavailable on its SSH host$/
    )
    mocks.stat.mockResolvedValue({ size: 4097, type: 'file' })
    mocks.range.mockClear()
    await expect(
      readSshDesktopPassword(approved, getSshProviderAuthority('personal'))
    ).rejects.toThrow(/unavailable/)
    expect(mocks.range).not.toHaveBeenCalled()
  })
  it('requires an actual RFB banner and cleans up the discovery connection', async () => {
    server = createServer((socket) => {
      socket.write('RFB 003.008\n')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP listener')
    }
    const { target } = policy(address.port)
    const close = vi.fn()
    mocks.route.mockResolvedValue({
      connect: ({ port }: { port: number }) => connect(port, '127.0.0.1'),
      close,
      isValid: () => true
    })
    await expect(probeDesktopVncTarget(target)).resolves.toBe(true)
    expect(close).toHaveBeenCalled()
  })
  it('allows fresh SSH setup beyond four seconds but keeps the probe bounded', async () => {
    vi.useFakeTimers()
    try {
      const { target } = policy()
      const socket = new Socket()
      const close = vi.fn()
      mocks.route.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5500))
        return { connect: () => socket, close, isValid: () => true }
      })
      const probe = probeDesktopVncTarget(target)
      await vi.advanceTimersByTimeAsync(5500)
      socket.emit('data', Buffer.from('RFB 003.008\n'))
      await expect(probe).resolves.toBe(true)
      expect(close).toHaveBeenCalled()

      const unavailable = new Socket()
      mocks.route.mockResolvedValue({ connect: () => unavailable, close, isValid: () => true })
      const missing = probeDesktopVncTarget(target)
      await vi.advanceTimersByTimeAsync(15000)
      await expect(missing).resolves.toBe(false)
      expect(unavailable.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
