import { BrowserWindow, ipcMain } from 'electron'
import { currentRuntime } from './ssh-ipc-context'
import {
  WorkspacePortScanParams,
  WorkspacePortKillParams
} from '../../shared/rpc-contract/workspace-ports-params'
import type { Store } from '../persistence'
import { advertisedUrlWatcher, type AdvertisedUrlWatcher } from '../ports/advertised-url-watcher'
import type {
  WorkspacePortAdvertisedUrlChangedEvent,
  WorkspacePortKillRequest,
  WorkspacePortKillResult,
  WorkspacePortScanRequest,
  WorkspacePortScanResult
} from '../../shared/workspace-ports'
import {
  getStoreWorkspacePortProbes,
  killWorkspacePort,
  scanWorkspacePortProbes
} from '../ports/workspace-port-ownership'

type WorkspacePortHandlersOptions = {
  advertisedUrlEvents?: Pick<AdvertisedUrlWatcher, 'onDidChange'>
  getWindows?: () => BrowserWindow[]
}

let unsubscribeAdvertisedUrlChanges: (() => void) | null = null

export function registerWorkspacePortHandlers(
  store: Store,
  options: WorkspacePortHandlersOptions = {}
): void {
  const inFlightScans = new Map<string, Promise<WorkspacePortScanResult>>()
  const advertisedUrlEvents = options.advertisedUrlEvents ?? advertisedUrlWatcher
  const getWindows = options.getWindows ?? (() => BrowserWindow.getAllWindows())

  unsubscribeAdvertisedUrlChanges?.()
  unsubscribeAdvertisedUrlChanges = advertisedUrlEvents.onDidChange((event) => {
    const localWorktrees = getStoreWorkspacePortProbes(store)
    if (!localWorktrees.some((worktree) => worktree.id === event.worktreeId)) {
      return
    }
    broadcastWorkspacePortAdvertisedUrlChanged(getWindows, event)
  })

  ipcMain.removeHandler('workspacePorts:scan')
  ipcMain.removeHandler('workspacePorts:kill')
  ipcMain.handle(
    'workspacePorts:scan',
    (_event, rawArgs?: unknown): Promise<WorkspacePortScanResult> => {
      const args = parseScanRequest(rawArgs)
      if (args?.includeSsh && currentRuntime) {
        return currentRuntime.scanWorkspacePorts(args.repoId, true)
      }
      const worktrees = getStoreWorkspacePortProbes(store, args?.repoId)
      const key = JSON.stringify(
        worktrees
          .map((worktree) => [worktree.id, worktree.repoId, worktree.displayName, worktree.path])
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
      )
      const existing = inFlightScans.get(key)
      if (existing) {
        return existing
      }

      const promise = scanWorkspacePortProbes(worktrees).finally(() => {
        if (inFlightScans.get(key) === promise) {
          inFlightScans.delete(key)
        }
      })
      inFlightScans.set(key, promise)
      return promise
    }
  )

  ipcMain.handle(
    'workspacePorts:kill',
    async (_event, rawArgs?: unknown): Promise<WorkspacePortKillResult> => {
      const args = parseKillRequest(rawArgs)
      if (!args) {
        return { ok: false, reason: 'Invalid process or port.' }
      }
      const worktrees = getStoreWorkspacePortProbes(store, args.repoId)
      return killWorkspacePort(worktrees, args)
    }
  )
}

function broadcastWorkspacePortAdvertisedUrlChanged(
  getWindows: () => BrowserWindow[],
  event: WorkspacePortAdvertisedUrlChangedEvent
): void {
  for (const window of getWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    const webContents = window.webContents
    if (webContents.isDestroyed()) {
      continue
    }
    webContents.send('workspacePorts:advertised-url-changed', event)
  }
}

function parseScanRequest(value: unknown): WorkspacePortScanRequest | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const result = WorkspacePortScanParams.safeParse(value)
  return result.success ? result.data : undefined
}

function parseKillRequest(value: unknown): WorkspacePortKillRequest | null {
  const parsed = WorkspacePortKillParams.safeParse(value)
  return parsed.success &&
    Number.isSafeInteger(parsed.data.pid) &&
    Number.isSafeInteger(parsed.data.port)
    ? parsed.data
    : null
}
