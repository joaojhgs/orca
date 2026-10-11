import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'

export const NOTIFICATION_DIGEST_WINDOW_MS = 60_000
const MAX_GROUPS = 128
const MAX_ITEMS = 32
const MAX_BYTES = 16 * 1024 * 1024
const identity = z.string().min(1).max(8192)
type DigestGroup<T> = { key: string; dueAt: number; items: { id: string; payload: T }[] }

/** Durable human-delivery batching, never a source of task or agent status. */
export class NotificationDigestQueue<T> {
  private readonly schema: z.ZodType<DigestGroup<T>[]>
  private groups: DigestGroup<T>[]
  private unavailable = false
  private draining = false
  private timer: ReturnType<typeof setInterval> | null = null
  private active = true
  private generation = 0

  constructor(
    private readonly path: string,
    payload: z.ZodType<T>,
    private readonly now: () => number = Date.now
  ) {
    this.schema = z
      .array(
        z.object({
          key: identity,
          dueAt: z.number().finite(),
          items: z
            .array(z.object({ id: identity, payload }))
            .min(1)
            .max(MAX_ITEMS)
        })
      )
      .max(MAX_GROUPS)
    this.groups = this.schema.parse([])
    try {
      if (statSync(path).size > MAX_BYTES) {
        throw new Error('Digest queue exceeds its storage bound')
      }
      hardenExistingSecureFile(path)
      this.groups = this.schema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      this.unavailable = !(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    }
  }

  enqueue(key: string, id: string, payload: T): boolean {
    if (this.unavailable) {
      return false
    }
    const existing = this.groups.find((group) => group.key === key)
    if (existing?.items.some((item) => item.id === id)) {
      return true
    }
    if (
      (existing?.items.length ?? 0) >= MAX_ITEMS ||
      (!existing && this.groups.length >= MAX_GROUPS)
    ) {
      return false
    }
    try {
      const next = existing
        ? this.groups.map((group) =>
            group === existing ? { ...group, items: [...group.items, { id, payload }] } : group
          )
        : [
            ...this.groups,
            { key, dueAt: this.now() + NOTIFICATION_DIGEST_WINDOW_MS, items: [{ id, payload }] }
          ]
      const checked = this.schema.parse(next)
      if (Buffer.byteLength(JSON.stringify(checked)) > MAX_BYTES) {
        return false
      }
      writeSecureJsonFile(this.path, checked)
      this.groups = checked
      return true
    } catch {
      return false
    }
  }

  cancel(predicate: (payload: T) => boolean): void {
    if (this.unavailable) {
      return
    }
    const next = this.groups.flatMap((group) => {
      const items = group.items.filter((item) => !predicate(item.payload))
      return items.length ? [{ ...group, items }] : []
    })
    if (
      next.some((group, index) => group.items.length !== this.groups[index]?.items.length) ||
      next.length !== this.groups.length
    ) {
      writeSecureJsonFile(this.path, next)
      this.groups = next
    }
  }

  async drain(
    deliver: (payloads: readonly T[], isPending: (payload: T) => boolean) => Promise<boolean>
  ): Promise<void> {
    if (this.draining || this.unavailable || !this.active) {
      return
    }
    this.draining = true
    const generation = this.generation
    try {
      for (const group of this.groups.filter((entry) => entry.dueAt <= this.now())) {
        const isPending = (payload: T) => {
          const itemId = group.items.find((item) => item.payload === payload)?.id
          return (
            this.active &&
            generation === this.generation &&
            this.groups.some(
              (current) =>
                current.key === group.key && current.items.some((item) => item.id === itemId)
            )
          )
        }
        let accepted = false
        try {
          accepted = await deliver(
            group.items.map((item) => item.payload),
            isPending
          )
        } catch {
          console.warn('[notifications] Digest handoff deferred')
        }
        if (!this.active || generation !== this.generation) {
          return
        }
        if (!accepted) {
          const next = this.groups.map((current) =>
            current.key === group.key
              ? { ...current, dueAt: this.now() + NOTIFICATION_DIGEST_WINDOW_MS }
              : current
          )
          writeSecureJsonFile(this.path, next)
          this.groups = next
          continue
        }
        const handedOff = new Set(group.items.map((item) => item.id))
        const next = this.groups.flatMap((current) => {
          if (current.key !== group.key) {
            return [current]
          }
          const items = current.items.filter((item) => !handedOff.has(item.id))
          return items.length
            ? [{ ...current, dueAt: this.now() + NOTIFICATION_DIGEST_WINDOW_MS, items }]
            : []
        })
        writeSecureJsonFile(this.path, next)
        this.groups = next
      }
    } finally {
      this.draining = false
    }
  }

  start(
    deliver: (payloads: readonly T[], isPending: (payload: T) => boolean) => Promise<boolean>
  ): void {
    this.stop()
    this.active = true
    const drain = () => {
      void this.drain(deliver).catch(() => console.warn('[notifications] Digest handoff deferred'))
    }
    this.timer = setInterval(drain, 5_000)
    this.timer.unref?.()
    drain()
  }

  stop(): void {
    this.active = false
    this.generation += 1
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = null
  }

  pendingCount(): number {
    return this.groups.reduce((count, group) => count + group.items.length, 0)
  }
}
