import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { ArtifactProjectGroup } from './artifact-project-groups'

export function ArtifactListFilters({
  projects,
  projectFilter,
  onProjectFilterChange,
  typeFilter,
  onTypeFilterChange
}: {
  projects: readonly ArtifactProjectGroup[]
  projectFilter: string
  onProjectFilterChange: (value: string) => void
  typeFilter: string
  onTypeFilterChange: (value: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <Select value={projectFilter} onValueChange={onProjectFilterChange}>
        <SelectTrigger
          size="sm"
          aria-label={t('artifacts.filters.project', 'Filter by project')}
          className="max-w-56"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectItem value="all">
              {t('artifacts.filters.allProjects', 'All projects')}
            </SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select value={typeFilter} onValueChange={onTypeFilterChange}>
        <SelectTrigger size="sm" aria-label={t('artifacts.filters.type', 'Filter by file type')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectItem value="all">{t('artifacts.filters.allTypes', 'All file types')}</SelectItem>
            <SelectItem value="text/markdown">
              {t('auto.components.artifacts.ArtifactListFilters.adeb734f7d', 'Markdown')}
            </SelectItem>
            <SelectItem value="application/pdf">
              {t('auto.components.artifacts.ArtifactListFilters.1545ccda6d', 'PDF')}
            </SelectItem>
            <SelectItem value="text/html">
              {t('auto.components.artifacts.ArtifactListFilters.ded7380c01', 'HTML')}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  )
}
