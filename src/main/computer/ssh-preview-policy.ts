import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getAppEnvironment } from '../../shared/app-environment'
import { AndroidPreviewApproval } from '../../shared/ssh-android-preview-contract'

const VncTarget = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
    label: z.string().trim().min(1).max(80),
    port: z.number().int().min(1).max(65535),
    viewOnly: z.boolean(),
    passwordFile: z.string().max(4096).refine(isAbsolute).optional()
  })
  .strict()
const Policy = z
  .object({
    hosts: z
      .array(
        z
          .object({
            targetId: z.string().min(1).max(256),
            vnc: z.array(VncTarget).max(16),
            adb: AndroidPreviewApproval.optional()
          })
          .strict()
      )
      .max(16)
  })
  .strict()

export type SshPreviewVncTarget = z.infer<typeof VncTarget> & {
  targetId: string
  desktopId: string
  policyFingerprint: string
}

export function readSshPreviewPolicy(userDataPath = getAppEnvironment().getPath('userData')) {
  const override = process.env.ORCA_SSH_PREVIEW_POLICY_FILE
  if (override && !isAbsolute(override)) {
    throw new Error('SSH preview policy path must be absolute')
  }
  const path = override || join(userDataPath, 'ssh-preview-policy.json')
  if (!existsSync(path)) {
    return { hosts: [], fingerprint: '' }
  }
  if (!statSync(path).isFile() || statSync(path).size > 64 * 1024) {
    throw new Error('Invalid SSH preview policy')
  }
  const bytes = readFileSync(path)
  if (bytes.length > 64 * 1024) {
    throw new Error('Invalid SSH preview policy')
  }
  const result = Policy.safeParse(JSON.parse(bytes.toString('utf8')))
  if (!result.success) {
    throw new Error('Invalid SSH preview policy')
  }
  const ids = new Set<string>()
  if (result.data.hosts.reduce((count, host) => count + host.vnc.length, 0) > 32) {
    throw new Error('Too many SSH preview desktops')
  }
  for (const host of result.data.hosts) {
    if (ids.has(host.targetId)) {
      throw new Error('Duplicate SSH preview host')
    }
    ids.add(host.targetId)
    if (new Set(host.vnc.map((target) => target.id)).size !== host.vnc.length) {
      throw new Error('Duplicate SSH preview desktop')
    }
  }
  return { ...result.data, fingerprint: createHash('sha256').update(bytes).digest('hex') }
}

export function listSshPreviewVncTargets(userDataPath?: string): SshPreviewVncTarget[] {
  const policy = readSshPreviewPolicy(userDataPath)
  return policy.hosts.flatMap((host) =>
    host.vnc.map((target) => ({
      ...target,
      targetId: host.targetId,
      desktopId: `ssh-vnc:${Buffer.from(JSON.stringify([host.targetId, target.id])).toString('base64url')}`,
      policyFingerprint: policy.fingerprint
    }))
  )
}

export function resolveSshPreviewVncTarget(desktopId: string): SshPreviewVncTarget {
  const target = listSshPreviewVncTargets().find((item) => item.desktopId === desktopId)
  if (!target) {
    throw new Error('Desktop is not approved for SSH preview')
  }
  return target
}
