import { z } from 'zod'
import type { ManagerEventPage } from '../../../shared/manager-event-contract'

export function waitForManagerEvent(
  listeners: Set<() => void>,
  read: () => ManagerEventPage,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ManagerEventPage> {
  z.number().int().min(1).max(30_000).parse(timeoutMs)
  const initial = read()
  if (initial.gap || initial.hasMore || initial.events.length) {
    return Promise.resolve(initial)
  }
  if (signal?.aborted) {
    return Promise.reject(new Error('Manager event wait cancelled'))
  }
  if (listeners.size >= 16) {
    return Promise.reject(new Error('Manager event wait capacity reached'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, page?: ManagerEventPage) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      listeners.delete(changed)
      signal?.removeEventListener('abort', abort)
      if (error) {
        reject(error)
      } else if (page) {
        resolve(page)
      }
    }
    const changed = (deadline = false) => {
      try {
        const page = read()
        if (
          deadline ||
          page.gap ||
          page.hasMore ||
          page.events.length ||
          page.cursor.sequence !== initial.cursor.sequence
        ) {
          finish(undefined, page)
        }
      } catch (error) {
        finish(error)
      }
    }
    const abort = () => finish(new Error('Manager event wait cancelled'))
    const timer = setTimeout(() => changed(true), timeoutMs)
    timer.unref()
    listeners.add(changed)
    signal?.addEventListener('abort', abort, { once: true })
    changed()
  })
}
