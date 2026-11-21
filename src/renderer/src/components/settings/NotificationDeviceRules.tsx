import { useEffect, useState } from 'react'
import {
  NOTIFICATION_POLICY_KINDS,
  type NotificationPolicyKind,
  type NotificationScopePolicy
} from '../../../../shared/notification-scope-policy'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../ui/field'
import { NotificationSettingToggle } from './notifications/NotificationSettingToggle'
import { NOTIFICATION_EVENT_LABELS } from './notification-rule-editing'
import { useTranslate } from '@/i18n/use-translate'

export function NotificationDeviceRules({
  owner,
  policy,
  save
}: {
  owner: RuntimeClientTarget
  policy: NotificationScopePolicy
  save: (next: NotificationScopePolicy) => Promise<void>
}): React.JSX.Element {
  const t = useTranslate()
  const [devices, setDevices] = useState<{ deviceId: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const kind = owner.kind
  const environmentId = owner.kind === 'environment' ? owner.environmentId : null
  useEffect(() => {
    let cancelled = false
    setDevices([])
    const target: RuntimeClientTarget =
      kind === 'environment' && environmentId
        ? { kind: 'environment', environmentId }
        : { kind: 'local' }
    const request = Promise.resolve().then(() =>
      target.kind === 'local'
        ? window.api.mobile.listDevices()
        : callRuntimeRpc<{ devices: { deviceId: string; name: string }[] }>(
            target,
            'pairing.admin.listDevices'
          )
    )
    void request.then(
      (result) => {
        if (!cancelled) {
          setDevices(result.devices)
          setError(null)
        }
      },
      () => {
        if (!cancelled) {
          setError('Could not list paired devices. Existing device overrides have been retained.')
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [kind, environmentId, reload])
  function update(
    deviceId: string,
    changes: { muted?: boolean; silent?: boolean; mutedEvents?: NotificationPolicyKind[] }
  ): void {
    setBusy(true)
    setError(null)
    void Promise.resolve()
      .then(() => {
        const existing = policy.deviceOverrides.find((row) => row.deviceId === deviceId)
        return save({
          ...policy,
          deviceOverrides: [
            ...policy.deviceOverrides.filter((row) => row.deviceId !== deviceId),
            { ...existing, deviceId, ...changes }
          ]
        })
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not save device policy.')
      })
      .finally(() => setBusy(false))
  }
  return (
    <FieldSet>
      <FieldLegend>
        {t('auto.components.settings.NotificationDeviceRules.2c9a66506e', 'Paired mobile devices')}
      </FieldLegend>
      <FieldDescription>
        {t(
          'auto.components.settings.NotificationDeviceRules.b84f9bc361',
          'A device mute is a final human-delivery veto. It never disables manager supervision or unmutes a project.'
        )}
      </FieldDescription>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <FieldGroup>
        {devices.map((device) => {
          const override = policy.deviceOverrides.find((row) => row.deviceId === device.deviceId)
          const muted = override?.muted === true
          return (
            <FieldGroup key={device.deviceId}>
              <NotificationSettingToggle
                label={device.name}
                description={t(
                  'auto.components.settings.NotificationDeviceRules.df1ab4fb25',
                  'Allow eligible human alerts on this paired device.'
                )}
                checked={!muted}
                disabled={busy}
                onToggle={() => void update(device.deviceId, { muted: !muted })}
              />
              <Collapsible>
                <NotificationSettingToggle
                  label={t(
                    'auto.components.settings.NotificationDeviceRules.e1bce71f07',
                    'Silent delivery'
                  )}
                  description={t(
                    'auto.components.settings.NotificationDeviceRules.2817a32123',
                    'Disable sounds without enabling any otherwise-muted alerts.'
                  )}
                  checked={override?.silent === true}
                  disabled={busy}
                  onToggle={() =>
                    void update(device.deviceId, { silent: override?.silent !== true })
                  }
                />
                <CollapsibleTrigger variant="row">
                  {t(
                    'auto.components.settings.NotificationDeviceRules.6956fc4253',
                    'Muted event types'
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FieldGroup>
                    {NOTIFICATION_POLICY_KINDS.map((kind) => (
                      <Field key={kind} orientation="horizontal" data-disabled={busy}>
                        <Checkbox
                          id={`notification-device-${device.deviceId}-${kind}`}
                          checked={override?.mutedEvents?.includes(kind) === true}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            void update(device.deviceId, {
                              mutedEvents:
                                checked === true
                                  ? [...new Set([...(override?.mutedEvents ?? []), kind])]
                                  : (override?.mutedEvents ?? []).filter((event) => event !== kind)
                            })
                          }
                        />
                        <FieldLabel htmlFor={`notification-device-${device.deviceId}-${kind}`}>
                          {NOTIFICATION_EVENT_LABELS[kind]}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            </FieldGroup>
          )
        })}
      </FieldGroup>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => setReload((value) => value + 1)}
      >
        {t('auto.components.settings.NotificationDeviceRules.c812aca905', 'Refresh paired devices')}
      </Button>
    </FieldSet>
  )
}
