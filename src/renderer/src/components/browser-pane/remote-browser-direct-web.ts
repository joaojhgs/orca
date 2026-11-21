import { useEffect, useState } from 'react'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

type ProxySession = {
  port: number
  token: string
  path: string
}

export function isDirectWebProxyCandidate(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '::1'].includes(hostname)
    )
  } catch {
    return false
  }
}

export function useRemoteBrowserDirectWeb(
  environmentId: string,
  rawUrl: string
): { url: string | null; error: string | null } {
  const [state, setState] = useState<{
    rawUrl: string
    environmentId: string
    url: string | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!isWebClientLocation() || !isDirectWebProxyCandidate(rawUrl)) {
      setState(null)
      return
    }
    let cancelled = false
    void callRuntimeRpc<ProxySession>(
      { kind: 'environment', environmentId },
      'browser.webProxyOpen',
      { url: rawUrl },
      { timeoutMs: 15_000 }
    )
      .then((session) => {
        if (cancelled) {
          return
        }
        const hostname = window.location.hostname
        const host =
          hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
        const url = new URL(`http://${host}:${session.port}${session.path || '/'}`)
        url.searchParams.set('__orca_proxy_token', session.token)
        setState({ rawUrl, environmentId, url: url.toString(), error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            rawUrl,
            environmentId,
            url: null,
            error: error instanceof Error ? error.message : 'Direct web proxy unavailable.'
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [rawUrl, environmentId])

  return state?.rawUrl === rawUrl && state.environmentId === environmentId
    ? { url: state.url, error: state.error }
    : { url: null, error: null }
}
