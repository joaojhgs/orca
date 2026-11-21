import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { SkillLibrarySnapshot } from '../../../../shared/skill-library-contract'

export function SkillLibraryProjectSelect(props: {
  id: string
  projectId: string
  projects: SkillLibrarySnapshot['projects']
  total: number
  disabled: boolean
  onChange(value: string): void
}) {
  const t = useTranslate()
  return (
    <>
      <Label htmlFor={props.id}>{t('skills.library.project', 'Project workspaces')}</Label>
      <Select value={props.projectId} disabled={props.disabled} onValueChange={props.onChange}>
        <SelectTrigger id={props.id}>
          <SelectValue placeholder={t('skills.library.chooseProject', 'Choose a project')} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.projects?.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t(
          'skills.library.projectAssignmentHelp',
          'Pins skills to {{total}} currently registered workspaces on the selected hosts. New workspaces are not automatically assigned.',
          { total: props.total }
        )}
      </p>
    </>
  )
}
