import { expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { NOTIFICATION_METHODS } from './notifications'

it('filters reconnect replay by the authenticated client destination, not mobile rules for everyone', async () => {
  const runtime = new OrcaRuntimeService()
  runtime.configureNotificationScopePolicy({
    read: () => ({
      rules: [
        {
          id: 'mobile-only',
          selector: { level: 'project', id: 'aurora' },
          human: { mode: 'off', destinations: ['mobile'] }
        }
      ],
      deviceOverrides: [{ deviceId: 'muted-desktop', muted: true }]
    }),
    scope: (event) => event.notificationScope ?? {}
  })
  runtime.dispatchMobileNotification({
    type: 'notification',
    source: 'agent-task-complete',
    title: 'done',
    body: '',
    notificationScope: { projectId: 'aurora' }
  })
  const replay = NOTIFICATION_METHODS.find(
    (method) => method.name === 'notifications.getMissedSince'
  )
  if (!replay) {
    throw new Error('Missing unary replay method')
  }
  const params = { lastSeenSeq: 0, includeDesktopSuppressed: true }
  expect(
    await replay.handler(params, { runtime, clientKind: 'mobile', pairedDeviceId: 'phone' })
  ).toMatchObject({ notifications: [] })
  expect(
    await replay.handler(params, { runtime, clientKind: 'runtime', pairedDeviceId: 'desktop' })
  ).toMatchObject({ notifications: [{ title: 'done' }] })
  expect(
    await replay.handler(params, {
      runtime,
      clientKind: 'runtime',
      pairedDeviceId: 'muted-desktop'
    })
  ).toMatchObject({ notifications: [] })
})

it('never suppresses dismissals for a muted device', async () => {
  const runtime = new OrcaRuntimeService()
  runtime.configureNotificationScopePolicy({
    read: () => ({ rules: [], deviceOverrides: [{ deviceId: 'phone', muted: true }] }),
    scope: () => ({})
  })
  runtime.dismissMobileNotification('old-alert')
  const replay = NOTIFICATION_METHODS.find(
    (method) => method.name === 'notifications.getMissedSince'
  )
  if (!replay) {
    throw new Error('Missing unary replay method')
  }
  expect(
    await replay.handler(
      { lastSeenSeq: 0 },
      {
        runtime,
        clientKind: 'mobile',
        pairedDeviceId: 'phone'
      }
    )
  ).toMatchObject({ notifications: [{ type: 'dismiss', notificationId: 'old-alert' }] })
})
