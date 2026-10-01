import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export type ArtifactPublishingApproval = {
  requestId: string
  command: string
  expiresAt: number
  enabled: boolean
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

// RPC can request an approval, but only a separate host-shell action supplies its proof.
export class ArtifactPublishingApprovalController {
  private pending: {
    request: ArtifactPublishingApproval
    owner: string
    path: string
    proof: string
  } | null = null

  constructor(
    private readonly directory: () => string,
    private readonly apply: (enabled: boolean) => void,
    private readonly now: () => number = Date.now
  ) {}

  async request(enabled: boolean, owner: string): Promise<ArtifactPublishingApproval> {
    if (process.platform === 'win32') {
      throw new Error('Use the desktop app on Windows.')
    }
    const directory = this.directory()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const requestId = randomUUID()
    const path = join(directory, `${requestId}.approval`)
    const proof = `${enabled ? 'ALLOW PUBLIC ARTIFACT LINKS' : 'DISABLE ARTIFACT PUBLISHING'}:${randomUUID()}`
    const request = {
      requestId,
      enabled,
      expiresAt: this.now() + 5 * 60_000,
      command: `(umask 077; printf '%s' ${quote(proof)} > ${quote(path)})`
    }
    if (this.pending) {
      await unlink(this.pending.path).catch(() => {})
    }
    this.pending = { request, owner, path, proof }
    return request
  }

  async check(requestId: string, owner: string): Promise<'pending' | 'expired' | 'approved'> {
    const pending = this.pending
    if (!pending || pending.owner !== owner || pending.request.requestId !== requestId) {
      throw new Error('Approval request not found for this client.')
    }
    if (this.now() >= pending.request.expiresAt) {
      this.pending = null
      await unlink(pending.path).catch(() => {})
      return 'expired'
    }
    const file = await open(pending.path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      () => null
    )
    if (!file) {
      return 'pending'
    }
    try {
      const stat = await file.stat()
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > 512
      ) {
        return 'pending'
      }
      if ((await file.readFile('utf8')) !== pending.proof) {
        return 'pending'
      }
      // Recheck after I/O: a concurrent request supersedes the old approval.
      if (this.pending !== pending || this.now() >= pending.request.expiresAt) {
        return 'expired'
      }
      this.pending = null
      this.apply(pending.request.enabled)
      await unlink(pending.path).catch(() => {})
      return 'approved'
    } finally {
      await file.close()
    }
  }
}
