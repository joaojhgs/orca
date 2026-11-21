import type { ComponentType } from 'react'
import { FolderOpen, Globe, Monitor, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export type AddRepoLocalStartActionHandlers = {
  onBrowse: () => void
  onOpenCloneStep: () => void
  onOpenRemoteStep: () => void
  onOpenCreateStep: () => void
  browseHostKind?: 'local' | 'runtime' | 'ssh'
  /** A paired server is selected, whose own SSH hosts the dialog explains instead of offering. */
  offersServerSshHosts?: boolean
}

export type AddRepoLocalStartAction = {
  kind: 'browse' | 'clone' | 'remote' | 'create'
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  disabled?: boolean
  onClick: () => void
}

export function getAddRepoLocalStartActions(
  {
    onBrowse,
    onOpenCloneStep,
    onOpenRemoteStep,
    onOpenCreateStep,
    browseHostKind = 'local',
    offersServerSshHosts = false
  }: AddRepoLocalStartActionHandlers,
  t: Translate = translate
): {
  primaryAction: AddRepoLocalStartAction
  secondaryActions: AddRepoLocalStartAction[]
} {
  const primaryAction = {
    kind: 'browse' as const,
    icon: FolderOpen,
    title: t('auto.components.sidebar.add.repo.local.start.actions.2281fdc8c7', 'Browse folder'),
    description:
      browseHostKind === 'ssh'
        ? t('project.add.sshBrowseDescription', 'Existing project or folder on this SSH host')
        : browseHostKind === 'runtime'
          ? t(
              'auto.components.sidebar.add.repo.local.start.actions.runtimeBrowseDescription',
              'Existing Git repository or folder on this host'
            )
          : t(
              'auto.components.sidebar.add.repo.local.start.actions.fb4fc5380e',
              'Local project, Git repo, or folder with many repos'
            ),
    onClick: onBrowse
  }

  const remote = {
    kind: 'remote' as const,
    icon: Monitor,
    title: t('auto.components.sidebar.AddRepoRemoteStep.91b93a90a4', 'Open project on SSH host'),
    description: offersServerSshHosts
      ? t('project.add.sshServerDescription', 'Browse SSH hosts registered with this server')
      : t('project.add.sshDesktopDescription', 'Browse SSH hosts registered with this desktop'),
    onClick: onOpenRemoteStep
  }
  const clone = {
    kind: 'clone' as const,
    icon: Globe,
    title: t('auto.components.sidebar.add.repo.local.start.actions.7edb8ebe24', 'Clone from URL'),
    description: t(
      'auto.components.sidebar.add.repo.local.start.actions.5f9ffac036',
      'Clone a remote Git repository'
    ),
    onClick: onOpenCloneStep
  }
  const create = {
    kind: 'create' as const,
    icon: Plus,
    title: t(
      'auto.components.sidebar.add.repo.local.start.actions.c709860596',
      'Create new project'
    ),
    description: t(
      'auto.components.sidebar.add.repo.local.start.actions.d72789705e',
      'Start from an empty folder'
    ),
    onClick: onOpenCreateStep
  }

  const secondaryActions = browseHostKind === 'ssh' ? [] : [clone, remote, create]

  return { primaryAction, secondaryActions }
}
