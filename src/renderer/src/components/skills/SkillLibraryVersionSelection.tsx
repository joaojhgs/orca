import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { translate } from '@/i18n/i18n'
import type { SkillLibraryVersion } from '../../../../shared/skill-library-contract'
import {
  groupLibrarySkills,
  libraryVersionPlugins,
  toggleLibrarySelection
} from '../../../../shared/skill-library-plugin'
import { SkillLibraryPluginGroup } from './SkillLibraryPluginGroup'

export function SkillLibraryVersionSelection(props: {
  versions: readonly SkillLibraryVersion[]
  selected: ReadonlySet<string>
  disabled: boolean
  onChange(selected: Set<string>): void
}) {
  const row = (version: SkillLibraryVersion) => (
    <Field key={version.versionId} orientation="horizontal">
      <Checkbox
        id={`library-version-${version.versionId}`}
        aria-label={translate('skills.library.includeVersion', 'Include {{name}}', {
          name: version.name
        })}
        checked={props.selected.has(version.versionId)}
        disabled={props.disabled}
        onCheckedChange={(checked) =>
          props.onChange(
            toggleLibrarySelection(props.selected, [version.versionId], checked === true)
          )
        }
      />
      <FieldLabel htmlFor={`library-version-${version.versionId}`}>{version.name}</FieldLabel>
      <span className="text-xs text-muted-foreground">{version.files.length} files</span>
    </Field>
  )
  return (
    <FieldGroup>
      {groupLibrarySkills(props.versions, libraryVersionPlugins).map((group) =>
        group.plugin ? (
          <SkillLibraryPluginGroup
            key={group.id}
            plugin={group.plugin}
            total={group.rows.length}
            selected={group.rows.filter((version) => props.selected.has(version.versionId)).length}
            selecting
            disabled={props.disabled}
            onSelect={(checked) =>
              props.onChange(
                toggleLibrarySelection(
                  props.selected,
                  group.rows.map((version) => version.versionId),
                  checked
                )
              )
            }
          >
            {group.rows.map(row)}
          </SkillLibraryPluginGroup>
        ) : (
          group.rows.map(row)
        )
      )}
    </FieldGroup>
  )
}
