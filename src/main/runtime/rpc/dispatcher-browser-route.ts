import type { RpcContext, RpcRequest } from './core'
import type { OrcaRuntimeService } from '../orca-runtime'
import { recordRuntimeFeatureInteraction } from './dispatch/runtime-feature-interaction'

export async function routeDispatcherBrowserCall(
  runtime: OrcaRuntimeService,
  request: RpcRequest,
  params: unknown,
  context: RpcContext
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  // Runtime test fakes may omit client-hosted browser routing.
  const clientHostedBrowser = await (runtime.routeClientHostedBrowserRpc?.(
    request.method,
    params,
    context.caller
  ) ?? { handled: false as const })
  if (clientHostedBrowser.handled) {
    recordRuntimeFeatureInteraction(
      runtime,
      request.method,
      clientHostedBrowser.result,
      undefined,
      request.params
    )
    return clientHostedBrowser
  }
  const desktopBrowser = await (runtime.routeDesktopBrowserBridgeRpc?.(
    request.method,
    params,
    context
  ) ?? { handled: false as const })
  return desktopBrowser
}
