import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SkillCloudOwnedShare } from '../../../../shared/skill-cloud-contract'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { useActiveSkillDiscoveryRuntimeTarget } from '@/hooks/use-active-skill-discovery-runtime-target'
import { LOCAL_SKILL_SHARING_CAPABILITY } from '../../../../shared/local-skill-sharing'
import type { RuntimeStatus } from '../../../../shared/runtime-types'

export type OwnedSkillShare = SkillCloudOwnedShare & { names?: string[] }

function inventoryError(status: string): string {
  return status === 'reconnect-required'
    ? translate(
        'auto.components.settings.shareSkills.linksReconnect',
        'Sign in again to manage shared links.'
      )
    : translate(
        'auto.components.settings.shareSkills.linksUnavailable',
        'Shared links are unavailable right now.'
      )
}

export type OwnedSkillShares = {
  shares: OwnedSkillShare[]
  loading: boolean
  error: string | null
  busyShareId: string | null
  refresh: () => void
  revoke: (share: SkillCloudOwnedShare) => Promise<void>
  local?: boolean
  enabled?: boolean
}

export function useOwnedSkillShares(targetOverride?: RuntimeClientTarget | null): OwnedSkillShares {
  const activeTarget = useActiveSkillDiscoveryRuntimeTarget()
  const target = targetOverride === undefined ? activeTarget : targetOverride
  const [shares, setShares] = useState<OwnedSkillShare[]>([])
  const [local, setLocal] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyShareId, setBusyShareId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const current = ++generation.current
    setLoading(true)
    setError(null)
    setShares([])
    setBusyShareId(null)
    setLocal(false)
    setEnabled(false)
    try {
      if (targetOverride !== undefined && !target) {
        setError(inventoryError('unavailable'))
        return
      }
      if (target) {
        const status = await callRuntimeRpc<RuntimeStatus>(target, 'status.get')
        if (status.capabilities?.includes(LOCAL_SKILL_SHARING_CAPABILITY)) {
          const result = await callRuntimeRpc<{
            supported: boolean
            enabled: boolean
            shares: OwnedSkillShare[]
          }>(target, 'skills.library.listShares')
          if (generation.current !== current) {
            return
          }
          if (result.supported) {
            setLocal(true)
            setEnabled(result.enabled)
            setShares(result.shares)
            return
          }
        }
      }
      if (targetOverride !== undefined) {
        if (generation.current === current) {
          setError(inventoryError('unavailable'))
        }
        return
      }
      if (generation.current !== current) {
        return
      }
      setLocal(false)
      const operation = await window.api.skills.listOwnedShares()
      if (generation.current !== current) {
        return
      }
      if (operation.status !== 'ok') {
        setError(inventoryError(operation.status))
        return
      }
      setShares(operation.value)
    } catch {
      if (generation.current === current) {
        setError(inventoryError('unavailable'))
      }
    } finally {
      if (generation.current === current) {
        setLoading(false)
      }
    }
  }, [target, targetOverride])

  useEffect(() => {
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])

  const revoke = useCallback(
    async (share: SkillCloudOwnedShare): Promise<void> => {
      const current = generation.current
      setBusyShareId(share.id)
      setError(null)
      try {
        if (local && target) {
          await callRuntimeRpc(target, 'skills.library.revokeShare', { shareId: share.id })
          if (generation.current === current) {
            setShares((rows) => rows.filter((row) => row.id !== share.id))
          }
          return
        }
        const operation = await window.api.skills.revokeShare(share.id)
        if (generation.current !== current) {
          return
        }
        if (operation.status !== 'ok') {
          setError(inventoryError(operation.status))
          return
        }
        setShares((current) => current.filter((candidate) => candidate.id !== share.id))
        toast.success(translate('auto.components.settings.shareSkills.linkRevoked', 'Link revoked'))
      } catch {
        if (generation.current === current) {
          setError(
            translate(
              'auto.components.settings.shareSkills.revokeFailed',
              'Orca could not revoke this link.'
            )
          )
        }
      } finally {
        if (generation.current === current) {
          setBusyShareId(null)
        }
      }
    },
    [local, target]
  )

  return {
    shares,
    loading,
    error,
    busyShareId,
    refresh: () => void load(),
    revoke,
    local,
    enabled
  }
}
