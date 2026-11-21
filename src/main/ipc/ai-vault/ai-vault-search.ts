import { ipcMain } from 'electron'
import {
  AiVaultSearchRequestSchema,
  AiVaultSetSearchEnabledParamsSchema
} from '../../../shared/ai-vault/search/ai-vault-search-contract'
import { clearSessionSearchInService } from '../../ai-vault/scan-service/session-scanner-service-spawn'
import {
  aiVaultSearchStatusByHost,
  configureAiVaultHostSearch,
  searchAiVaultSessionsByHost,
  setAiVaultSearchEnabledByHost,
  type AiVaultHostSearchOptions
} from './ai-vault-host-search'

export function registerAiVaultSearchHandlers(options: AiVaultHostSearchOptions = {}): void {
  configureAiVaultHostSearch(options)
  // Async so a refused scope reaches the renderer as a rejection, like every other parse failure.
  ipcMain.handle('aiVault:searchSessions', async (_event, raw: unknown, rawScope?: unknown) => {
    return searchAiVaultSessionsByHost(AiVaultSearchRequestSchema.parse(raw), rawScope)
  })
  ipcMain.handle('aiVault:searchStatus', async (_event, rawScope?: unknown) => {
    return aiVaultSearchStatusByHost(rawScope)
  })
  ipcMain.handle(
    'aiVault:setSearchEnabled',
    async (_event, rawScope: unknown, rawEnabled: unknown) => {
      const { enabled } = AiVaultSetSearchEnabledParamsSchema.parse({ enabled: rawEnabled })
      return setAiVaultSearchEnabledByHost(rawScope, enabled)
    }
  )
  ipcMain.handle('aiVault:clearSearchIndex', () => clearSessionSearchInService())
}
