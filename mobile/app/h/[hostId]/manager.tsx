import { useLocalSearchParams } from 'expo-router'
import { MobileManagerScreen } from '../../../src/manager/MobileManagerScreen'
import { MobileWebShellScreen } from '../../../src/mobile-web-shell/MobileWebShellScreen'
import {
  shellScreenRoute,
  shellScreenRouteKey
} from '../../../src/mobile-web-shell/routing/shell-screen-route'
import { firstParam } from '../../../src/navigation/route-param-reader'

export default function MobileManagerRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[]; runId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const runId = firstParam(params.runId)
  const native = <MobileManagerScreen />
  const route = hostId
    ? shellScreenRoute({
        pathname: `/h/${encodeURIComponent(hostId)}/manager`,
        ...(runId ? { params: { runId } } : {})
      })
    : null
  if (route === null) {
    return native
  }
  return (
    <MobileWebShellScreen
      key={shellScreenRouteKey(route)}
      hostId={hostId}
      route={route}
      fallback={native}
    />
  )
}
