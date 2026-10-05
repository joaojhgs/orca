import { useEffect, useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'

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
  target: RuntimeClientTarget,
  rawUrl: string
): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({
    url: null,
    error: null
  })

  useEffect(() => {
    if (!isWebClientLocation() || !isDirectWebProxyCandidate(rawUrl)) {
      setState({ url: null, error: null })
      return
    }
    let cancelled = false
    void callRuntimeRpc<ProxySession>(
      target,
      'browser.webProxyOpen',
      { url: rawUrl },
      { timeoutMs: 15_000 }
    )
      .then((session) => {
        if (cancelled) {
          return
        }
        const host = window.location.hostname.includes(':')
          ? `[${window.location.hostname}]`
          : window.location.hostname
        const url = new URL(`http://${host}:${session.port}${session.path || '/'}`)
        url.searchParams.set('__orca_proxy_token', session.token)
        setState({ url: url.toString(), error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            url: null,
            error: error instanceof Error ? error.message : 'Direct web proxy unavailable.'
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [rawUrl, target])

  return state
}
