import { describe, expect, it } from 'vitest'
import { isDirectWebProxyCandidate } from './remote-browser-direct-web'

describe('isDirectWebProxyCandidate', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:41971/path', 'https://[::1]:8443'])(
    'allows loopback web apps: %s',
    (url) => {
      expect(isDirectWebProxyCandidate(url)).toBe(true)
    }
  )

  it.each(['https://example.com', 'file:///tmp/index.html', 'javascript:alert(1)', 'nope'])(
    'rejects non-workspace targets: %s',
    (url) => {
      expect(isDirectWebProxyCandidate(url)).toBe(false)
    }
  )
})
