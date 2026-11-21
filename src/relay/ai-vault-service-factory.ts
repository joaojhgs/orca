import type { RemoteHostPlatform } from '../main/ssh/remote-host/ssh-remote-platform'
import { RelayAiVaultServiceClient } from './ai-vault-service-client'
import { spawnRelayAiVaultService } from './ai-vault-service-spawn'

export function createRelayAiVaultService(
  remoteHome: string,
  hostPlatform: RemoteHostPlatform
): RelayAiVaultServiceClient {
  return new RelayAiVaultServiceClient({
    init: { remoteHome, hostPlatform },
    processFactory: spawnRelayAiVaultService
  })
}
