import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, lstatSync } from 'node:fs'
import { isIP } from 'node:net'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { NETWORK_FORWARD_PATH } from '../../shared/network-forward-contract'
import { isCurrentSshProviderAuthority } from '../ssh/connection/authority/ssh-provider-authority'
import { requireDesktopSshAuthority, openDesktopSshRoute } from '../computer/ssh-desktop-vnc-route'

const Policy = z
  .object({
    connectAddress: z
      .string()
      .refine((value) => isIP(value) !== 0)
      .optional(),
    publicOrigin: z
      .string()
      .url()
      .refine((value) => {
        const u = new URL(value)
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          u.pathname === '/' &&
          !u.search &&
          !u.hash
        )
      }),
    routes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
            label: z.string().min(1).max(120),
            targetId: z.string().min(1).max(256),
            host: z.string().refine((value) => isIP(value) !== 0),
            port: z.number().int().min(1).max(65535)
          })
          .strict()
      )
      .max(64)
  })
  .strict()

export function readAgentForwardPolicy() {
  const path =
    process.env.ORCA_NETWORK_FORWARD_POLICY_FILE ??
    join(getAppEnvironment().getPath('userData'), 'network-forward-policy.json')
  if (!isAbsolute(path)) {
    throw new Error('Network forward policy must be an absolute path')
  }
  if (!existsSync(path)) {
    return { publicOrigin: '', routes: [], fingerprint: '', connectAddress: undefined }
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || stat.mode & 0o022) {
    throw new Error('Invalid network forward policy file')
  }
  const bytes = readFileSync(path)
  if (bytes.length > 65536) {
    throw new Error('Network forward policy too large')
  }
  const policy = Policy.parse(JSON.parse(bytes.toString()))
  if (new Set(policy.routes.map((r) => r.id)).size !== policy.routes.length) {
    throw new Error('Duplicate network route ID')
  }
  return { ...policy, fingerprint: createHash('sha256').update(bytes).digest('hex') }
}

export type AgentForwardTarget = ReturnType<typeof resolveAgentForward>
export function resolveAgentForward(routeId: string) {
  const policy = readAgentForwardPolicy()
  const route = policy.routes.find((r) => r.id === routeId)
  if (!route) {
    throw new Error('Network route is not approved by the owner')
  }
  return {
    ...route,
    fingerprint: policy.fingerprint,
    authority: requireDesktopSshAuthority(route.targetId),
    publicOrigin: policy.publicOrigin,
    connectAddress: policy.connectAddress
  }
}

export function agentForwardIsCurrent(target: AgentForwardTarget): boolean {
  try {
    return (
      readAgentForwardPolicy().fingerprint === target.fingerprint &&
      isCurrentSshProviderAuthority(target.authority)
    )
  } catch {
    return false
  }
}

const tickets = new Map<string, { target: AgentForwardTarget; expiresAt: number }>()
export function mintAgentForwardTicket(routeId: string) {
  const target = resolveAgentForward(routeId)
  for (const [id, t] of tickets) {
    if (t.expiresAt < Date.now()) {
      tickets.delete(id)
    }
  }
  if (tickets.size >= 64) {
    throw new Error('Too many pending forward connections')
  }
  const ticket = randomBytes(32).toString('base64url')
  tickets.set(ticket, { target, expiresAt: Date.now() + 30000 })
  return {
    routeId,
    connectAddress: target.connectAddress,
    url: `${target.publicOrigin.replace(/^https:/, 'wss:') + NETWORK_FORWARD_PATH}?ticket=${ticket}`
  }
}
export function consumeAgentForwardTicket(ticket: string) {
  const saved = tickets.get(ticket)
  tickets.delete(ticket)
  return saved && saved.expiresAt >= Date.now() && agentForwardIsCurrent(saved.target)
    ? saved.target
    : null
}
export async function openAgentForward(target: AgentForwardTarget, signal: AbortSignal) {
  if (!agentForwardIsCurrent(target)) {
    throw new Error('Network route authority expired')
  }
  return openDesktopSshRoute(target.authority, signal)
}
