import { z } from 'zod'

// Execution and consent use their existing audited RPC methods, not this settings bridge.
export const PLUGIN_MANAGEMENT_METHODS = [
  'getInstalledManifest',
  'listLanguagePacks',
  'listThemes',
  'listTerminalThemes',
  'listIconThemes',
  'loadIconTheme',
  'listSyntaxes',
  'loadSyntax',
  'resolveGitSource',
  'listMarketplaces',
  'addMarketplace',
  'removeMarketplace',
  'refreshMarketplaces',
  'listMarketplacePlugins',
  'previewMarketplacePlugin',
  'installMarketplacePlugin',
  'previewMarketplaceUpdate',
  'rollbackMarketplacePlugin',
  'getRollbackVersion',
  'getAutoUpdateState',
  'getInstallCounts',
  'getSettings',
  'setSetting',
  'install'
] as const

export type PluginManagementMethod = (typeof PLUGIN_MANAGEMENT_METHODS)[number]

export const PluginManagementParams = z
  .object({
    method: z.enum(PLUGIN_MANAGEMENT_METHODS),
    args: z.unknown().optional()
  })
  .strict()
