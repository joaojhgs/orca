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
import { NotificationSettingToggle } from './NotificationSettingToggle'
import { NOTIFICATION_EVENT_LABELS } from './notification-rule-editing'

export function NotificationDeviceRules({
  owner,
  policy,
  save
}: {
  owner: RuntimeClientTarget
  policy: NotificationScopePolicy
  save: (next: NotificationScopePolicy) => Promise<void>
}): React.JSX.Element {
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
  async function update(
    deviceId: string,
    changes: { muted?: boolean; silent?: boolean; mutedEvents?: NotificationPolicyKind[] }
  ) {
    setBusy(true)
    setError(null)
    try {
      const existing = policy.deviceOverrides.find((row) => row.deviceId === deviceId)
      await save({
        ...policy,
        deviceOverrides: [
          ...policy.deviceOverrides.filter((row) => row.deviceId !== deviceId),
          { ...existing, deviceId, ...changes }
        ]
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save device policy.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <FieldSet>
      <FieldLegend>Paired mobile devices</FieldLegend>
      <FieldDescription>
        A device mute is a final human-delivery veto. It never disables manager supervision or
        unmutes a project.
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
                description="Allow eligible human alerts on this paired device."
                checked={!muted}
                disabled={busy}
                onToggle={() => void update(device.deviceId, { muted: !muted })}
              />
              <Collapsible>
                <NotificationSettingToggle
                  label="Silent delivery"
                  description="Disable sounds without enabling any otherwise-muted alerts."
                  checked={override?.silent === true}
                  disabled={busy}
                  onToggle={() =>
                    void update(device.deviceId, { silent: override?.silent !== true })
                  }
                />
                <CollapsibleTrigger variant="row">Muted event types</CollapsibleTrigger>
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
        Refresh paired devices
      </Button>
    </FieldSet>
  )
}
