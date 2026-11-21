import { defineMethod } from '../../core'
import { workspaceWebProxyManager } from '../../../../browser/workspace-web-proxy'
import { BrowserWebProxyOpen } from '../../../../../shared/rpc-contract/browser-grab-params'

export const BROWSER_WEB_PROXY_METHODS = [
  defineMethod({
    name: 'browser.webProxyOpen',
    permission: 'workspace',
    params: BrowserWebProxyOpen,
    handler: async ({ url }) => workspaceWebProxyManager.open(url)
  })
]
