import { useEffect, useRef, useState } from 'react'
import type {
  SkillLibrarySnapshot,
  SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import type { SkillInstallDestination } from '../../../../shared/skill-install-contract'
import { SkillLibraryAssignDialog } from './SkillLibraryAssignDialog'
import {
  assignSkillBatch,
  type SkillAssignmentBatchProgress,
  type SkillAssignmentBatchResult
} from './skill-library-batch-assign'
import type { useSkillLibrary } from './use-skill-library'

export function SkillLibraryBulkAssign(props: {
  versions: SkillLibraryVersion[]
  snapshot: SkillLibrarySnapshot
  library: ReturnType<typeof useSkillLibrary>
  onClose(): void
  onCompleted(results: SkillAssignmentBatchResult[]): void
}) {
  const [outcomes, setOutcomes] = useState<SkillAssignmentBatchResult[] | null>(null)
  const [progress, setProgress] = useState<SkillAssignmentBatchProgress | null>(null)
  const active = useRef(true)
  const submitting = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const assign = async (destination: SkillInstallDestination, providers: string[]) => {
    if (submitting.current || outcomes) {
      return
    }
    submitting.current = true
    try {
      const result = await props.library.run((target) =>
        assignSkillBatch({
          target,
          versions: props.versions,
          snapshot: props.snapshot,
          destination,
          providers,
          isCurrent: () => active.current,
          onProgress: (value) => {
            if (active.current) {
              setProgress(value)
            }
          }
        })
      )
      if (!result || !active.current) {
        return
      }
      setOutcomes(result)
      await props.library.refresh()
      if (active.current) {
        props.onCompleted(result)
      }
    } finally {
      submitting.current = false
    }
  }
  return (
    <SkillLibraryAssignDialog
      version={props.versions[0] ?? null}
      versions={props.versions}
      snapshot={props.snapshot}
      busy={props.library.busy}
      error={props.library.error}
      progress={progress}
      outcomes={outcomes}
      onClose={props.onClose}
      onAssign={(destination, providers) => void assign(destination, providers)}
    />
  )
}
