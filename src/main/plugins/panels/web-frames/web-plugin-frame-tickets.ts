import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  pluginDeclarativeHostUrl,
  pluginFrameKey,
  pluginFrameUrl
} from '../../../../shared/plugins/frames/plugin-frame-guest'
import type {
  PluginFrameEntry,
  PluginFrameTheme
} from '../../../../shared/plugins/frames/plugin-frame-bridge'
import type { PluginService } from '../../plugin-service'
import { createPluginFrameRequestHandler } from '../plugin-frame-protocol'

export const WEB_PLUGIN_ENTRY_PREFIX = '/__orca_plugin_frame/'
export const WEB_PLUGIN_COOKIE = '__Host-orca-plugin-frame'

type Ticket = {
  service: PluginService
  ownerKey: string
  sessionToken: string
  pluginKey: string
  frameKey: string
  handle: (request: Request) => Promise<Response>
}
const tickets = new Map<string, Ticket>()
const tokenBySession = new Map<string, string>()

export function webPluginFrameDomain(): string | null {
  const domain = process.env.ORCA_PLUGIN_FRAME_DOMAIN?.trim().toLowerCase()
  return domain && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) ? domain : null
}

export function resolveWebPluginFrame(token: string, host: string): Ticket | null {
  const ticket = tickets.get(token)
  if (
    !ticket ||
    host !== `${ticket.frameKey}.${webPluginFrameDomain()}` ||
    !ticket.service.panels.sessionCaller(ticket.ownerKey, ticket.sessionToken)
  ) {
    return null
  }
  return ticket
}

export function allowsWebPluginFrameHost(host: string): boolean {
  for (const [token] of tickets) {
    if (resolveWebPluginFrame(token, host)) {
      return true
    }
  }
  return false
}

export function prepareWebPluginFrame(args: {
  service: PluginService
  ownerKey: string
  pluginKey: string
  surface: 'panel' | 'editor'
  id: string
  entry: PluginFrameEntry | null
  theme?: PluginFrameTheme
}): PluginFrameEntry | null {
  const domain = webPluginFrameDomain()
  if (!args.entry || !domain) {
    return args.entry
  }
  const { service, pluginKey, surface, id, ownerKey } = args
  const plugin = service.findApprovedPlugin(pluginKey)
  const contribution =
    surface === 'panel'
      ? plugin?.manifest.contributes.panels.find((panel) => panel.id === id)
      : plugin?.manifest.contributes.customEditors.find((editor) => editor.id === id)
  if (!plugin || !contribution) {
    return null
  }
  const frameKey = pluginFrameKey(pluginKey)
  const sessionToken = args.entry.sessionToken
  let token = tokenBySession.get(sessionToken)
  if (!token || !tickets.has(token)) {
    while (tickets.size >= 1024) {
      const first = tickets.entries().next().value
      if (!first) {
        break
      }
      tickets.delete(first[0])
      tokenBySession.delete(first[1].sessionToken)
    }
    token = randomBytes(32).toString('base64url')
    const theme = args.theme
    tickets.set(token, {
      service,
      ownerKey,
      sessionToken,
      pluginKey,
      frameKey,
      handle: createPluginFrameRequestHandler(
        {
          browser: true,
          findApprovedPluginByFrameKey: (key) =>
            key === frameKey ? service.findApprovedPlugin(pluginKey, true) : null,
          currentTheme: () => theme ?? null,
          readDeclarativeRuntime: () =>
            service.options.declarativeRuntimePath
              ? readFile(service.options.declarativeRuntimePath)
              : Promise.reject(new Error('Plugin component runtime is unavailable'))
        },
        frameKey
      )
    })
    tokenBySession.set(sessionToken, token)
  }
  const target =
    'ui' in contribution && contribution.ui === 'components'
      ? pluginDeclarativeHostUrl(frameKey, contribution.entry)
      : pluginFrameUrl(frameKey, contribution.entry)
  const path = target.slice(target.indexOf('/', target.indexOf('://') + 3))
  return {
    ...args.entry,
    guest: {
      partition: '',
      web: true,
      url: `https://${frameKey}.${domain}${WEB_PLUGIN_ENTRY_PREFIX}${token}${path}`
    }
  }
}
