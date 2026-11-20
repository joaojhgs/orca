import { useEffect, useRef, useState } from 'react'
import type {
  SkillLibrarySnapshot,
  SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import type { SkillInstallDestination } from '../../../../shared/skill-install-contract'
import { SkillLibraryAssignDialog } from './SkillLibraryAssignDialog'
import type {
  SkillAssignmentBatchProgress,
  SkillAssignmentBatchResult
} from './skill-library-batch-assign'
import type { useSkillLibrary } from './use-skill-library'
import { assignSkillDestinations } from './skill-library-batch-destinations'

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
  const assign = async (
    destination: SkillInstallDestination | SkillInstallDestination[],
    providers: string[],
    versions = props.versions
  ) => {
    if (submitting.current || outcomes) {
      return
    }
    submitting.current = true
    try {
      const destinations = Array.isArray(destination) ? destination : [destination]
      const result = await props.library.run((target) =>
        assignSkillDestinations({
          target,
          versions,
          snapshot: props.snapshot,
          destinations,
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
      onAssign={(destination, providers, versions) => void assign(destination, providers, versions)}
    />
  )
}
