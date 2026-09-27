import type { HostMemory, SessionMemory } from '../../shared/types'

export type RemoteResourceWorktree = {
  worktreeId: string | null
  sessions: SessionMemory[]
}

export type RemoteResourceSnapshot = {
  host: HostMemory
  worktrees: RemoteResourceWorktree[]
}

type RemoteResourceProvider = {
  name: string
  collect: () => Promise<RemoteResourceSnapshot>
}

const providers = new Map<string, RemoteResourceProvider>()

export function registerRemoteResourceProvider(
  connectionId: string,
  provider: RemoteResourceProvider
): void {
  providers.set(connectionId, provider)
}

export function unregisterRemoteResourceProvider(connectionId: string): void {
  providers.delete(connectionId)
}

export function listRemoteResourceProviders(): (RemoteResourceProvider & {
  connectionId: string
})[] {
  return Array.from(providers, ([connectionId, provider]) => ({ connectionId, ...provider }))
}
