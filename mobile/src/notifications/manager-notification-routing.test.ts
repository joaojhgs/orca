import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha256'
import { managerNotificationId } from '../../../src/shared/manager-notification-target'
import {
  getNotificationNavigationTarget,
  notificationCredentialRecoveryRoute
} from './notification-routing'
import { pushNotificationRouteData } from './push-receive'
import {
  navigateToHostStackRoute,
  type HostStackNavigationState
} from '../navigation/host-stack-navigation'

vi.mock('react-native', () => ({ AppState: { currentState: 'background' } }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('expo-notifications', () => ({}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: vi.fn() }))
vi.mock('./push-tray-dismissal', () => ({ dismissPresentedPushNotification: vi.fn() }))

const publicKeyB64 = Buffer.alloc(32, 1).toString('base64')
const hostFingerprint = Buffer.from(sha256(Buffer.alloc(32, 1)))
  .toString('base64url')
  .slice(0, 16)
const hosts = [{ id: 'controller', publicKeyB64 }]
const notificationId = managerNotificationId({ runId: 'run_one', messageId: 'msg_question' })

describe('manager notification navigation', () => {
  it.each(['apns', 'fcm'])(
    'routes %s by paired controller fingerprint, not supplied host/run fields',
    (format) => {
      const fields = {
        hostFingerprint,
        notificationId,
        hostId: 'evil',
        runId: 'run_evil',
        worktreeId: 'folder:original'
      }
      const data = pushNotificationRouteData(
        format === 'apns' ? { orca: fields, hostId: 'evil' } : fields,
        hosts,
        true
      )
      expect(
        getNotificationNavigationTarget(data, { knownHostIds: new Set(['controller']) })
      ).toEqual({
        hostId: 'controller',
        sessionTarget: {
          name: '[hostId]/manager',
          params: { hostId: 'controller', runId: 'run_one' }
        }
      })
      expect(
        pushNotificationRouteData({ ...fields, hostFingerprint: 'unknown' }, hosts, true)
      ).toBeNull()
    }
  )

  it('keeps ordinary and malformed notifications on their existing workspace route', () => {
    for (const id of [
      'agent:one',
      'manager:v1:run_one:msg_question:host_other',
      'manager:v1:run_%2F:msg_one'
    ]) {
      const data = pushNotificationRouteData(
        { hostFingerprint, notificationId: id, worktreeId: 'folder:original', runId: 'run_forged' },
        hosts,
        true
      )
      expect(getNotificationNavigationTarget(data)?.sessionTarget?.params).toEqual({
        hostId: 'controller',
        worktreeId: 'folder:original'
      })
    }
  })

  it.each(['missing', 'temporarily-unavailable'] as const)(
    'preserves credential recovery for %s controllers',
    (status) => {
      const target = getNotificationNavigationTarget(
        { hostId: 'controller', notificationId },
        {
          knownHostIds: new Set(['controller']),
          credentialStatusByHostId: new Map([['controller', status]])
        }
      )
      expect(target).not.toBeNull()
      if (!target) {
        throw new Error('Missing target')
      }
      expect(notificationCredentialRecoveryRoute(target)).toBe(
        status === 'missing' ? '/pair-scan' : '/'
      )
      expect(target.sessionTarget?.params.runId).toBe('run_one')
    }
  )

  it('retargets an already open manager conversation without remounting the controller stack', () => {
    const state: HostStackNavigationState = {
      index: 0,
      routes: [
        {
          name: 'h',
          state: {
            key: 'host-stack',
            index: 0,
            routes: [
              {
                name: '[hostId]/manager',
                key: 'manager',
                params: { hostId: 'controller', runId: 'run_previous' }
              }
            ]
          }
        }
      ]
    }
    const navigation = {
      getState: () => state,
      dispatch: vi.fn(),
      addListener: vi.fn(() => () => {})
    }
    const router = { push: vi.fn(), replace: vi.fn() }
    const target = getNotificationNavigationTarget({
      hostId: 'controller',
      notificationId
    })?.sessionTarget
    if (!target) {
      throw new Error('Missing target')
    }
    navigateToHostStackRoute(navigation, router, 'controller', target)
    expect(navigation.dispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMS',
      target: 'host-stack',
      source: 'manager',
      payload: { params: target.params }
    })
    expect(router.push).not.toHaveBeenCalled()
  })
})
