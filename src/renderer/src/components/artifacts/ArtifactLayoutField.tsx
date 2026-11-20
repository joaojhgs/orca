import { useId } from 'react'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import type { ArtifactMarkdownLayout } from './artifact-share-layout'

export function ArtifactLayoutField({
  value,
  onChange
}: {
  value: ArtifactMarkdownLayout
  onChange: (value: ArtifactMarkdownLayout) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <FieldGroup>
      <Field>
        <FieldLabel id={id}>{translate('artifacts.share.layout', 'Page layout')}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={value}
          aria-labelledby={id}
          onValueChange={(next) => {
            if (next === 'full-width' || next === 'a4') {
              onChange(next)
            }
          }}
        >
          <ToggleGroupItem value="full-width">
            {translate('artifacts.share.fullWidth', 'Full width')}
          </ToggleGroupItem>
          <ToggleGroupItem value="a4">
            {translate('artifacts.share.a4', 'Centered A4')}
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
    </FieldGroup>
  )
}
