import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  SKILL_LIBRARY_CAPABILITY,
  SkillLibrarySnapshotSchema,
  type SkillLibrarySnapshot
} from '../../../../shared/skill-library-contract'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { translate } from '@/i18n/i18n'

export function useSkillLibrary(target: RuntimeClientTarget | null) {
  const [catalog, setCatalog] = useState<{
    target: RuntimeClientTarget | null
    snapshot: SkillLibrarySnapshot
  } | null>(null)
  const [activity, setActivity] = useState<{
    target: RuntimeClientTarget | null
    busy: boolean
    error: string | null
  }>({ target, busy: false, error: null })
  const owner = useRef(target)
  const generation = useRef(0)
  owner.current = target

  const run = useCallback(
    async <T>(operation: (target: RuntimeClientTarget) => Promise<T>): Promise<T | undefined> => {
      if (!target) {
        return undefined
      }
      const current = ++generation.current
      setActivity({ target, busy: true, error: null })
      try {
        const result = await operation(target)
        if (owner.current !== target || current !== generation.current) {
          return undefined
        }
        return result
      } catch (cause) {
        if (owner.current === target && current === generation.current) {
          setActivity({
            target,
            busy: false,
            error:
              cause instanceof Error
                ? cause.message
                : translate(
                    'skills.library.operationFailed',
                    'The library operation failed. Check the execution host and retry.'
                  )
          })
        }
        return undefined
      } finally {
        if (owner.current === target && current === generation.current) {
          setActivity((state) => ({ ...state, busy: false }))
        }
      }
    },
    [target]
  )

  const load = useCallback(async (runtime: RuntimeClientTarget) => {
    const status = await callRuntimeRpc<RuntimeStatus>(runtime, 'status.get')
    if (!status.capabilities?.includes(SKILL_LIBRARY_CAPABILITY)) {
      throw new Error(
        translate(
          'skills.library.updateRequired',
          'This Orca server needs an update before it can manage a local skill library.'
        )
      )
    }
    return SkillLibrarySnapshotSchema.parse(
      await callRuntimeRpc(runtime, 'skills.library.list', undefined, { timeoutMs: 120000 })
    )
  }, [])

  const refresh = useCallback(async () => {
    const result = await run(load)
    if (result) {
      setCatalog({ target, snapshot: result })
    }
  }, [load, run, target])

  const mutate = useCallback(
    async (method: string, params: unknown) => {
      const result = await run(async (runtime) => {
        const response = await callRuntimeRpc<unknown>(runtime, method, params, {
          timeoutMs: 600000
        })
        return { response, snapshot: await load(runtime) }
      })
      if (result) {
        setCatalog({ target, snapshot: result.snapshot })
      }
      return result?.response
    },
    [load, run, target]
  )

  useEffect(() => {
    owner.current = target
    void refresh()
    return () => {
      generation.current += 1
      owner.current = null
    }
  }, [refresh, target])

  return {
    snapshot: catalog?.target === target ? catalog.snapshot : null,
    busy: activity.target === target && activity.busy,
    error: activity.target === target ? activity.error : null,
    run,
    refresh,
    mutate
  }
}
