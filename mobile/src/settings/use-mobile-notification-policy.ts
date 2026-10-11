import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { NotificationScopePolicy } from '../../../src/shared/notification-scope-policy'
import {
  notificationPolicyEditorTargets,
  type NotificationPolicyReceipt,
  type NotificationPolicyTarget
} from '../../../src/shared/notification-policy-target'
import { mobileNotificationPolicyCall } from './mobile-notification-policy-operations'

export function useMobileNotificationPolicy(client: RpcClient | null, owner: string) {
  const generation = client?.getGeneration?.() ?? 0
  const connected = client?.getState() === 'connected'
  const current = useRef({ client, owner, generation })
  current.current = { client, owner, generation }
  const revision = useRef(0)
  const saveInFlight = useRef(false)
  const loadedOwner = useRef<{ client: RpcClient; owner: string; generation: number } | null>(null)
  const [receipt, setReceipt] = useState<NotificationPolicyReceipt | null>(null)
  const [targets, setTargets] = useState<NotificationPolicyTarget[]>([])
  const [devices, setDevices] = useState<{ deviceId: string; name: string }[]>([])
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!client || !connected || saveInFlight.current) {
      return
    }
    const sequence = ++revision.current
    const isCurrent = () =>
      revision.current === sequence &&
      current.current.client === client &&
      current.current.owner === owner &&
      current.current.generation === generation
    const call = mobileNotificationPolicyCall(client, isCurrent)
    setBusy(true)
    setError(null)
    try {
      const value = await call.read()
      const inventory: NotificationPolicyTarget[] = []
      let offset = 0
      for (let page = 0; page < 50; page++) {
        const result = await call.targets(offset)
        inventory.push(...result.targets)
        if (result.nextOffset === null) {
          if (isCurrent()) {
            try {
              const result = await call.devices()
              if (isCurrent()) {
                setDevices(result.devices)
                setDeviceError(null)
              }
            } catch {
              if (isCurrent()) {
                setDevices([])
                setDeviceError(
                  'Could not list paired devices. Saved device overrides are retained.'
                )
              }
            }
            if (isCurrent()) {
              loadedOwner.current = { client, owner, generation: client.getGeneration?.() ?? 0 }
              setReceipt(value)
              setTargets(notificationPolicyEditorTargets(inventory, value.policy))
            }
          }
          return
        }
        if (result.nextOffset <= offset) {
          throw new Error('Server returned an invalid notification scope page.')
        }
        offset = result.nextOffset
      }
      throw new Error('Too many notification scopes. Use the server’s settings to narrow them.')
    } catch (failure) {
      if (isCurrent()) {
        setReceipt(null)
        setError(failure instanceof Error ? failure.message : 'Could not load server rules.')
      }
    } finally {
      if (isCurrent()) {
        setBusy(false)
      }
    }
  }, [client, connected, owner, generation])
  useEffect(() => {
    revision.current++
    saveInFlight.current = false
    setReceipt(null)
    setTargets([])
    setDevices([])
    setDeviceError(null)
    setBusy(false)
    setError(null)
    void refresh()
    return () => {
      revision.current++
    }
  }, [refresh])
  const save = async (policy: NotificationScopePolicy) => {
    if (
      !client ||
      !receipt ||
      busy ||
      saveInFlight.current ||
      loadedOwner.current?.client !== client ||
      loadedOwner.current.owner !== owner ||
      loadedOwner.current.generation !== generation
    ) {
      return
    }
    saveInFlight.current = true
    const sequence = ++revision.current
    const isCurrent = () =>
      revision.current === sequence &&
      current.current.client === client &&
      current.current.owner === owner &&
      current.current.generation === generation
    const call = mobileNotificationPolicyCall(client, isCurrent)
    setBusy(true)
    setError(null)
    try {
      const saved = await call.update(policy, receipt.revision)
      if (isCurrent()) {
        setReceipt(saved)
        setTargets((rows) => notificationPolicyEditorTargets(rows, saved.policy))
      }
    } catch (failure) {
      if (isCurrent()) {
        setReceipt(null)
        setError(
          `${failure instanceof Error ? failure.message : 'Save unconfirmed.'} Refresh before retrying.`
        )
      }
    } finally {
      if (isCurrent()) {
        saveInFlight.current = false
        setBusy(false)
      }
    }
  }
  const loaded =
    connected &&
    loadedOwner.current?.client === client &&
    loadedOwner.current.owner === owner &&
    loadedOwner.current.generation === generation
  return {
    devices: loaded ? devices : [],
    deviceError: loaded ? deviceError : null,
    receipt: loaded ? receipt : null,
    targets: loaded ? targets : [],
    busy,
    error,
    refresh,
    save,
    connected
  }
}
