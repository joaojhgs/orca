// A service with an IP deny-all policy can use a loopback reverse proxy for one
// fixed external API. The logical origin (including signed proofs) stays unchanged.
// This is not a general proxy: redirects, other origins, and userinfo are refused.
export function fixedOriginFetch(
  origin: string,
  transport: string | undefined,
  fetcher = globalThis.fetch
): typeof fetch {
  if (!transport) {
    return fetcher
  }
  const destination = new URL(transport)
  if (
    destination.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(destination.hostname) ||
    destination.username ||
    destination.password ||
    destination.search ||
    destination.hash
  ) {
    throw new Error('API transport must be a credential-free loopback HTTP URL')
  }
  const prefix = destination.pathname.replace(/\/$/, '')
  return async (input, init) => {
    const requested = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    if (requested.origin !== origin || requested.username || requested.password) {
      throw new Error('API origin refused')
    }
    const url = new URL(destination.origin)
    url.pathname = `${prefix}${requested.pathname}`
    url.search = requested.search
    return fetcher(url, { ...init, redirect: 'error' })
  }
}
