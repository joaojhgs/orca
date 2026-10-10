import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SkillInstallWorkspaceCombobox } from '@/components/skills/SkillInstallWorkspaceCombobox'
import type { SkillInstallWorkspaceChoice } from '@/components/skills/skill-install-workspace-choices'
import { translate } from '@/i18n/i18n'
import type { ManagerPublicPrincipal } from '../../../../shared/manager-conversation-contract'

export function ManagerObjectiveForm(props: {
  principals: readonly ManagerPublicPrincipal[]
  workspaces: readonly SkillInstallWorkspaceChoice[]
  initialWorkspaceId: string
  disabled: boolean
  onCreate(principalId: string, workspaceId: string, objective: string): Promise<boolean>
}): React.JSX.Element {
  const eligible = props.principals.filter(
    (entry) => entry.state === 'active' && entry.actions.includes('run:create')
  )
  const [principalChoice, setPrincipalChoice] = useState('')
  const principalId = principalChoice || (eligible.length === 1 ? eligible[0].id : '')
  const [workspaceId, setWorkspaceId] = useState(props.initialWorkspaceId)
  const [objective, setObjective] = useState('')
  const canSubmit =
    !props.disabled &&
    eligible.some((entry) => entry.id === principalId) &&
    props.workspaces.some((entry) => entry.id === workspaceId) &&
    Boolean(objective.trim())
  const t = translate
  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) {
          void props.onCreate(principalId, workspaceId, objective)
        }
      }}
    >
      <FieldGroup>
        <Field data-disabled={props.disabled}>
          <FieldLabel htmlFor="manager-principal">{t('manager.operator', 'Manager')}</FieldLabel>
          <Select value={principalId} onValueChange={setPrincipalChoice} disabled={props.disabled}>
            <SelectTrigger id="manager-principal">
              <SelectValue placeholder={t('manager.selectOperator', 'Select a manager')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {eligible.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {t(
              'manager.scopeHelp',
              'The server checks this manager’s permitted projects and execution hosts before accepting an objective.'
            )}
          </FieldDescription>
        </Field>
        <Field data-disabled={props.disabled}>
          <FieldLabel htmlFor="manager-workspace">{t('manager.workspace', 'Workspace')}</FieldLabel>
          <SkillInstallWorkspaceCombobox
            id="manager-workspace"
            value={workspaceId}
            onValueChange={setWorkspaceId}
            choices={props.workspaces}
            disabled={props.disabled}
          />
        </Field>
        <Field data-disabled={props.disabled}>
          <FieldLabel htmlFor="manager-objective">{t('manager.objective', 'Objective')}</FieldLabel>
          <Textarea
            id="manager-objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            disabled={props.disabled}
            maxLength={32_000}
            rows={6}
            required
          />
          <FieldDescription>
            {t(
              'manager.objectiveHelp',
              'Give Hermes an outcome and constraints. Existing user sessions are not automatically adopted.'
            )}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={!canSubmit}>
        {t('manager.createObjective', 'Send objective')}
      </Button>
    </form>
  )
}
