import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'
import { hasVisibleOverlay } from '@/lib/visible-overlay'
import {
  SkillLibraryImportResultSchema,
  SkillLibraryPreviewSchema,
  type SkillLibraryPreview,
  type SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import { useSkillLibrary } from './use-skill-library'
import { useOwnedSkillShares } from './use-owned-skill-shares'
import {
  discoverSkillLibraryHosts,
  type HostedSkillCandidate
} from './skill-library-host-discovery'

export type SkillLibraryPageProps = {
  target: RuntimeClientTarget | null
  onBack?(): void
  onClose(): void
  requestedSharedView?: boolean
  onSharedViewHandled?(): void
}
type View = 'catalog' | 'import' | 'assignments' | 'shared'
type Confirmation = { kind: 'delete' | 'unassign'; id: string; name: string }
export function useSkillLibraryPage(props: SkillLibraryPageProps) {
  const { requestedSharedView, onSharedViewHandled, onClose } = props
  const library = useSkillLibrary(props.target)
  const shares = useOwnedSkillShares(props.target)
  const [view, setView] = useState<View>('catalog')
  const [hostId, setHostId] = useState('all')
  const [query, setQuery] = useState('')
  const [importQuery, setImportQuery] = useState('')
  const [candidates, setCandidates] = useState<HostedSkillCandidate[] | null>(null)
  const [review, setReview] = useState<SkillLibraryPreview | null>(null)
  const [reviewSource, setReviewSource] = useState<{ hostId: string; candidateId: string } | null>(
    null
  )
  const [savedReview, setSavedReview] = useState<SkillLibraryVersion | null>(null)
  const [assignVersion, setAssignVersion] = useState<SkillLibraryVersion | null>(null)
  const [bulkAssignVersions, setBulkAssignVersions] = useState<SkillLibraryVersion[]>([])
  const [selectionAction, setSelectionAction] = useState<'share' | 'assign'>('share')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [shareVersions, setShareVersions] = useState<SkillLibraryVersion[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const confirmDialog = useConfirmationDialog()
  const owner = useRef(props.target)
  owner.current = props.target
  const [stateTarget, setStateTarget] = useState(props.target)
  if (stateTarget !== props.target) {
    setStateTarget(props.target)
    setView('catalog')
    setCandidates(null)
    setReview(null)
    setReviewSource(null)
    setSavedReview(null)
    setAssignVersion(null)
    setBulkAssignVersions([])
    setSelectionAction('share')
    setShareVersions([])
    setSelected(new Set())
    setSelecting(false)
    setNotice(null)
    setHostId('all')
    setQuery('')
    setImportQuery('')
  }
  useEffect(() => {
    if (requestedSharedView) {
      setView('shared')
      onSharedViewHandled?.()
    }
  }, [requestedSharedView, onSharedViewHandled])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasVisibleOverlay()) {
        return
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.matches('input,textarea,select,[contenteditable="true"]')
      ) {
        return
      }
      event.preventDefault()
      if (selecting) {
        setSelecting(false)
        setSelected(new Set())
      } else if (view !== 'catalog') {
        setView('catalog')
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [view, selecting, onClose])
  const scan = async () => {
    const result = await library.run((target) =>
      discoverSkillLibraryHosts(target, library.snapshot?.hosts ?? [], hostId)
    )
    if (result) {
      setCandidates(result.candidates)
      setNotice(result.issues.length ? result.issues.join(' · ') : null)
    }
  }
  const preview = async (
    source: { hostId: string; candidateId: string } | SkillLibraryVersion,
    filePath?: string
  ) => {
    setNotice(null)
    const saved = 'versionId' in source
    const result = await library.run(async (target) =>
      SkillLibraryPreviewSchema.parse(
        await callRuntimeRpc(
          target,
          saved ? 'skills.library.previewVersion' : 'skills.library.preview',
          saved ? { versionId: source.versionId, filePath } : { ...source, filePath },
          { timeoutMs: 120000 }
        )
      )
    )
    if (result) {
      setReview(result)
      setSavedReview(saved ? source : null)
      setReviewSource(saved ? null : source)
    }
  }
  const importReview = async (addVersion: boolean) => {
    if (!review || !reviewSource) {
      return
    }
    const response = await library.mutate('skills.library.import', {
      hostId: reviewSource.hostId,
      candidateIds: [review.candidate.id],
      reviewed: true,
      addVersion,
      expectedDigests: [{ candidateId: review.candidate.id, packageDigest: review.packageDigest }]
    })
    if (!response) {
      return
    }
    const result = SkillLibraryImportResultSchema.safeParse(response)
    if (!result.success) {
      setNotice(
        translate(
          'skills.library.unexpectedImport',
          'Unexpected import response. Refresh the library before retrying.'
        )
      )
      return
    }
    setNotice(
      result.data.results
        .map((row) => `${row.status}${row.message ? `: ${row.message}` : ''}`)
        .join(' · ')
    )
    if (
      result.data.results.length &&
      result.data.results.every((row) => row.status === 'imported' || row.status === 'unchanged')
    ) {
      setReview(null)
      setReviewSource(null)
      setView('catalog')
    }
  }
  const confirm = async (confirmation: Confirmation) => {
    const target = props.target
    const approved = await confirmDialog({
      title:
        confirmation.kind === 'delete'
          ? translate('skills.library.deleteTitle', 'Delete saved version: {{name}}', {
              name: confirmation.name
            })
          : translate('skills.library.unassignTitle', 'Unassign skill: {{name}}', {
              name: confirmation.name
            }),
      description:
        confirmation.kind === 'delete'
          ? translate(
              'skills.library.deleteHelp',
              'Remove this unassigned snapshot from the library. Original skill folders are not deleted.'
            )
          : translate(
              'skills.library.unassignHelp',
              'Remove only Orca-owned, unmodified placements. Edited files and unowned originals remain protected; an offline host queues removal.'
            ),
      confirmLabel:
        confirmation.kind === 'delete'
          ? translate('skills.library.deleteVersion', 'Delete version')
          : translate('skills.library.unassign', 'Unassign'),
      confirmVariant: 'destructive'
    })
    if (!approved || owner.current !== target) {
      return
    }
    await library.mutate(
      confirmation.kind === 'delete' ? 'skills.library.deleteVersion' : 'skills.library.unassign',
      confirmation.kind === 'delete'
        ? { versionId: confirmation.id }
        : { assignmentId: confirmation.id }
    )
  }
  const select = (id: string, value: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (value && next.size < 50) {
        next.add(id)
      } else if (!value) {
        next.delete(id)
      }
      return next
    })
  const publish = async (bundleName: string) => {
    const result = await library.run(async (target) =>
      z.object({ url: z.url(), packageDigest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(
        await callRuntimeRpc(
          target,
          'skills.library.share',
          {
            versionIds: shareVersions.map((version) => version.versionId),
            bundleName,
            reviewed: true
          },
          { timeoutMs: 120000 }
        )
      )
    )
    if (result) {
      shares.refresh()
    }
    return result ?? null
  }
  return {
    library,
    shares,
    view,
    setView,
    hostId,
    setHostId,
    query,
    setQuery,
    importQuery,
    setImportQuery,
    candidates,
    setCandidates,
    review,
    setReview,
    reviewSource,
    setReviewSource,
    savedReview,
    setSavedReview,
    assignVersion,
    setAssignVersion,
    bulkAssignVersions,
    setBulkAssignVersions,
    selectionAction,
    setSelectionAction,
    selecting,
    setSelecting,
    selected,
    setSelected,
    shareVersions,
    setShareVersions,
    notice,
    setNotice,
    scan,
    preview,
    importReview,
    confirm,
    select,
    publish
  }
}
