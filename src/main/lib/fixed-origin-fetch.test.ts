import { expect, it, vi } from 'vitest'
import { fixedOriginFetch } from './fixed-origin-fetch'

it('proxies only the fixed origin while preserving path, auth, and rejecting redirects', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
  const request = fixedOriginFetch('https://push.onorca.dev', 'http://127.0.0.1:6770', fetcher)
  await request('https://push.onorca.dev/v1/send', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture' }
  })
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://127.0.0.1:6770/v1/send')
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    method: 'POST',
    headers: { authorization: 'Bearer fixture' }
  })
  await expect(request('https://169.254.169.254/latest')).rejects.toThrow('origin refused')
  await expect(request('https://user:secret@push.onorca.dev/v1/send')).rejects.toThrow(
    'origin refused'
  )
})
it.each([
  'http://10.0.0.1:6770',
  'https://example.com',
  'http://user:pass@127.0.0.1:6770',
  'http://127.0.0.1:6770?redirect=true'
])('rejects unsafe transport %s', (transport) => {
  expect(() => fixedOriginFetch('https://push.onorca.dev', transport)).toThrow('loopback')
})
