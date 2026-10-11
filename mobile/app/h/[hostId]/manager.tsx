import { useLocalSearchParams } from 'expo-router'
import { MobileManagerScreen } from '../../../src/manager/MobileManagerScreen'
import { MobileWebShellScreen } from '../../../src/mobile-web-shell/MobileWebShellScreen'
import {
  shellScreenRoute,
  shellScreenRouteKey
} from '../../../src/mobile-web-shell/shell-screen-route'
import { shellSwitchDecision } from '../../../src/mobile-web-shell/shell-switch-decision'
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
  const decision = shellSwitchDecision(route)
  if (decision.kind === 'native') {
    return native
  }
  return (
    <MobileWebShellScreen
      key={shellScreenRouteKey(decision.route)}
      hostId={hostId}
      route={decision.route}
      fallback={native}
    />
  )
}
