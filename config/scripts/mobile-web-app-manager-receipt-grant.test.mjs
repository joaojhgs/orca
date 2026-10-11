import { describe, expect, it } from 'vitest'
import { mobileWebAppRouteClosure } from './build-mobile-web-app-bundle.mjs'
import { MOBILE_WEB_PAGE_ROUTES } from './mobile-web-page-routes.mjs'
import {
  PAGE_ROUTE_MODULES,
  pageRouteModulesCoverTheManifest
} from './mobile-web-app-page-route-modules.mjs'

describe('the manager page native receipt boundary', () => {
  it('requires acknowledged native recovery and never bundles native pairing storage', async () => {
    expect(pageRouteModulesCoverTheManifest(MOBILE_WEB_PAGE_ROUTES).mapped).toEqual(
      pageRouteModulesCoverTheManifest(MOBILE_WEB_PAGE_ROUTES).declared
    )
    const closure = await mobileWebAppRouteClosure(PAGE_ROUTE_MODULES.get('/h/[hostId]/manager'))
    expect(closure.local).toContain('src/manager/page-manager-receipt-store.ts')
    expect(closure.local).toContain('src/manager/use-mobile-manager-receipt-store.web.ts')
    expect(closure.local).not.toContain('src/manager/native-manager-receipt-verb-server.ts')
    expect(closure.local).not.toContain('src/manager/mobile-manager-request-store.ts')
    expect(
      MOBILE_WEB_PAGE_ROUTES.find((route) => route.pathname === '/h/[hostId]/manager').grants
    ).toContain('native.manager.receipt')
    expect(
      MOBILE_WEB_PAGE_ROUTES.filter((route) => route.grants.includes('native.manager.receipt')).map(
        (route) => route.pathname
      )
    ).toEqual(['/h/[hostId]/manager'])
  })
})
