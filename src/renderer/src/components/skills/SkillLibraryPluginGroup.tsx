import { useId, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel, FieldSet, FieldLegend, FieldDescription } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { SkillLibraryPlugin } from '../../../../shared/skill-library-plugin'

export function SkillLibraryPluginGroup(props: {
  plugin: SkillLibraryPlugin
  total: number
  selected: number
  disabled: boolean
  selecting: boolean
  onSelect(checked: boolean): void
  onAssign?(): void
  onShare?(): void
  children: ReactNode
}) {
  const id = useId()
  return (
    <FieldSet className="gap-2">
      <FieldLegend className="mb-0">
        <Field orientation="horizontal">
          {props.selecting ? (
            <Checkbox
              id={id}
              aria-label={translate('skills.library.selectPlugin', 'Select plugin {{name}}', {
                name: props.plugin.name
              })}
              checked={
                props.selected === props.total ? true : props.selected ? 'indeterminate' : false
              }
              disabled={props.disabled}
              onCheckedChange={(value) => props.onSelect(value === true)}
            />
          ) : null}
          <FieldLabel htmlFor={props.selecting ? id : undefined}>
            {props.plugin.name}
            {props.plugin.version ? ` · ${props.plugin.version}` : ''}
            {` · ${props.selected}/${props.total}`}
          </FieldLabel>
          {props.onAssign ? (
            <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.onAssign}>
              {translate('skills.library.assignPlugin', 'Assign plugin')}
            </Button>
          ) : null}
          {props.onShare ? (
            <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.onShare}>
              {translate('skills.library.sharePlugin', 'Share plugin')}
            </Button>
          ) : null}
        </Field>
      </FieldLegend>
      <FieldDescription>{props.plugin.source}</FieldDescription>
      <div className="flex flex-col gap-2 pl-6">{props.children}</div>
    </FieldSet>
  )
}
