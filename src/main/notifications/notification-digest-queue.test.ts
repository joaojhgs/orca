import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { NotificationDigestQueue, NOTIFICATION_DIGEST_WINDOW_MS } from './notification-digest-queue'

const paths: string[] = []
function path() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-digest-'))
  paths.push(dir)
  return join(dir, 'queue.json')
}
afterEach(() => {
  paths.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  paths.length = 0
})
describe('durable bounded notification digests', () => {
  it('backs off a failed relevance/handoff callback while retaining its durable record', async () => {
    let now = 0
    const queue = new NotificationDigestQueue(path(), z.string(), () => now)
    queue.enqueue('g', 'id', 'message')
    now = 60_000
    const fail = vi.fn(async () => {
      throw new Error('transport details not logged')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await queue.drain(fail)
      await queue.drain(fail)
      expect(fail).toHaveBeenCalledOnce()
      expect(queue.pendingCount()).toBe(1)
      expect(warn).toHaveBeenCalledExactlyOnceWith('[notifications] Digest handoff deferred')
    } finally {
      warn.mockRestore()
    }
  })
  it('fences a stopped queue while an asynchronous delivery check is in flight', async () => {
    let now = 0
    const file = path()
    const queue = new NotificationDigestQueue(file, z.string(), () => now)
    queue.enqueue('g', 'id', 'message')
    now = 60_000
    let finish: () => void = () => undefined
    const checked: boolean[] = []
    const draining = queue.drain(async (items, isPending) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      checked.push(isPending(items[0]))
      return true
    })
    queue.stop()
    finish()
    await draining
    expect(checked).toEqual([false])
    expect(new NotificationDigestQueue(file, z.string()).pendingCount()).toBe(1)
  })
  it('rechecks cancellation without losing the original id when enqueue reparses the queue', async () => {
    let now = 0
    const queue = new NotificationDigestQueue(path(), z.object({ text: z.string() }), () => now)
    queue.enqueue('g', 'one', { text: 'first' })
    now = 60_000
    await queue.drain(async (items, isPending) => {
      queue.enqueue('g', 'two', { text: 'second' })
      expect(isPending(items[0])).toBe(true)
      queue.cancel((payload) => payload.text === 'first')
      expect(isPending(items[0])).toBe(false)
      return true
    })
    expect(queue.pendingCount()).toBe(1)
  })
  it('uses a fixed one-minute window, de-duplicates and survives restart with private permissions', async () => {
    let now = 100
    const file = path()
    const queue = new NotificationDigestQueue(file, z.string(), () => now)
    expect(queue.enqueue('project', 'one', 'first')).toBe(true)
    now += 30_000
    expect(queue.enqueue('project', 'one', 'ignored retry')).toBe(true)
    expect(queue.enqueue('project', 'two', 'second')).toBe(true)
    const restarted = new NotificationDigestQueue(file, z.string(), () => now)
    const deliver = vi.fn(async (_items: readonly string[]) => true)
    await restarted.drain(deliver)
    expect(deliver).not.toHaveBeenCalled()
    now = 100 + NOTIFICATION_DIGEST_WINDOW_MS
    await restarted.drain(deliver)
    expect(deliver).toHaveBeenCalledExactlyOnceWith(['first', 'second'], expect.any(Function))
    expect(new NotificationDigestQueue(file, z.string()).pendingCount()).toBe(0)
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
  })
  it('retains ambiguous handoffs with bounded retry delay, not a tight drain loop', async () => {
    let now = 0
    const queue = new NotificationDigestQueue(path(), z.string(), () => now)
    queue.enqueue('g', 'id', 'message')
    now = 60_000
    const defer = vi.fn(async () => false)
    await queue.drain(defer)
    await queue.drain(defer)
    expect(defer).toHaveBeenCalledOnce()
    expect(queue.pendingCount()).toBe(1)
    now += 60_000
    await queue.drain(async () => true)
    expect(queue.pendingCount()).toBe(0)
  })
  it('preserves new messages appended while the original batch is handed off', async () => {
    let now = 0
    const queue = new NotificationDigestQueue(path(), z.string(), () => now)
    queue.enqueue('g', 'one', 'first')
    now = 60_000
    await queue.drain(async () => {
      queue.enqueue('g', 'two', 'second')
      return true
    })
    expect(queue.pendingCount()).toBe(1)
    const deliver = vi.fn(async () => true)
    await queue.drain(deliver)
    expect(deliver).not.toHaveBeenCalled()
    now += 60_000
    await queue.drain(deliver)
    expect(deliver).toHaveBeenCalledExactlyOnceWith(['second'], expect.any(Function))
  })
  it('persists cancellation and never overwrites malformed existing storage', () => {
    const file = path()
    const queue = new NotificationDigestQueue(file, z.string())
    queue.enqueue('g', 'one', 'first')
    queue.enqueue('g', 'two', 'second')
    queue.cancel((item) => item === 'first')
    expect(new NotificationDigestQueue(file, z.string()).pendingCount()).toBe(1)
    writeFileSync(file, '{malformed')
    const unavailable = new NotificationDigestQueue(file, z.string())
    expect(unavailable.enqueue('g', 'new', 'third')).toBe(false)
    unavailable.cancel(() => true)
    expect(readFileSync(file, 'utf8')).toBe('{malformed')
  })
  it('refuses overflow without evicting existing records or delivering immediately', () => {
    const queue = new NotificationDigestQueue(path(), z.string())
    for (let n = 0; n < 32; n++) {
      expect(queue.enqueue('g', String(n), String(n))).toBe(true)
    }
    expect(queue.enqueue('g', 'overflow', 'overflow')).toBe(false)
    expect(queue.pendingCount()).toBe(32)
    for (let n = 1; n < 128; n++) {
      expect(queue.enqueue(String(n), 'one', 'one')).toBe(true)
    }
    expect(queue.enqueue('overflow-group', 'one', 'one')).toBe(false)
    expect(queue.pendingCount()).toBe(159)
  })
})
