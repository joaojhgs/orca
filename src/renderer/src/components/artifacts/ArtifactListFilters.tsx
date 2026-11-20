import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
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
  return (
    <>
      <Select value={projectFilter} onValueChange={onProjectFilterChange}>
        <SelectTrigger
          size="sm"
          aria-label={translate('artifacts.filters.project', 'Filter by project')}
          className="max-w-56"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectItem value="all">
              {translate('artifacts.filters.allProjects', 'All projects')}
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
        <SelectTrigger
          size="sm"
          aria-label={translate('artifacts.filters.type', 'Filter by file type')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectItem value="all">
              {translate('artifacts.filters.allTypes', 'All file types')}
            </SelectItem>
            <SelectItem value="text/markdown">Markdown</SelectItem>
            <SelectItem value="application/pdf">PDF</SelectItem>
            <SelectItem value="text/html">HTML</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  )
}
