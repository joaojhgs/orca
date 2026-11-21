import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { NotificationScopePolicy } from '../../../../shared/notification-scope-policy'
import {
  notificationSelectorKey,
  notificationSelectorScope,
  type NotificationPolicyTarget
} from '../../../../shared/notification-policy-target'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { NotificationRuleEditor } from './NotificationRuleEditor'
import { NotificationDeviceRules } from './NotificationDeviceRules'
import type { RuleActor, RuleDestination } from './notification-rule-editing'
import { useTranslate } from '@/i18n/use-translate'

const emptyPolicy: NotificationScopePolicy = { rules: [], deviceOverrides: [] }

export function NotificationScopeRules({
  owner
}: {
  owner: RuntimeClientTarget
}): React.JSX.Element {
  const t = useTranslate()
  const environmentId = owner.kind === 'environment' ? owner.environmentId : null
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<NotificationPolicyTarget[]>([])
  const [selected, setSelected] = useState('')
  const [actor, setActor] = useState<RuleActor>('any')
  const [destination, setDestination] = useState<RuleDestination>('both')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [policy, setPolicy] = useState(emptyPolicy)
  const [revision, setRevision] = useState<string | null>(null)
  const saving = useRef(false)
  const currentOwner = useRef<string | null | undefined>(undefined)
  useLayoutEffect(() => {
    currentOwner.current = environmentId
    return () => {
      currentOwner.current = undefined
    }
  }, [environmentId])
  async function onChange(next: NotificationScopePolicy): Promise<void> {
    if (!revision || saving.current) {
      throw new Error('Refresh scopes or wait for the current policy save before retrying.')
    }
    saving.current = true
    return callRuntimeRpc<{ policy: NotificationScopePolicy; revision: string }>(
      owner,
      'notifications.policyUpdate',
      { policy: next, expectedRevision: revision }
    )
      .then((saved) => {
        if (currentOwner.current !== environmentId) {
          throw new Error(
            'Policy saved on the previous server. Refresh the current server before editing.'
          )
        }
        setPolicy(saved.policy)
        setRevision(saved.revision)
      })
      .finally(() => {
        saving.current = false
      })
  }
  useEffect(() => {
    if (!open) {
      return
    }
    const controller = new AbortController()
    const target: RuntimeClientTarget =
      environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }
    setTargets([])
    setPolicy(emptyPolicy)
    setRevision(null)
    setLoading(true)
    setError(null)
    void (async () => {
      const saved = await callRuntimeRpc<{ policy: NotificationScopePolicy; revision: string }>(
        target,
        'notifications.policyRead',
        undefined,
        { signal: controller.signal }
      )
      const rows: NotificationPolicyTarget[] = []
      let offset = 0
      for (let page = 0; page < 50; page++) {
        const result = await callRuntimeRpc<{
          targets: NotificationPolicyTarget[]
          nextOffset: number | null
        }>(
          target,
          'notifications.policyTargets',
          { offset, limit: 200 },
          { signal: controller.signal }
        )
        rows.push(...result.targets)
        if (result.nextOffset === null) {
          if (!controller.signal.aborted) {
            setTargets(rows)
            setPolicy(saved.policy)
            setRevision(saved.revision)
          }
          return
        }
        offset = result.nextOffset
      }
      throw new Error('Too many notification scopes. Narrow the active server before editing.')
    })()
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load scopes. This server may need an update.'
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [open, environmentId, reload])
  const options = [...targets]
  for (const rule of policy.rules) {
    if (
      !options.some(
        (row) => notificationSelectorKey(row.selector) === notificationSelectorKey(rule.selector)
      )
    ) {
      options.push({
        label: t(
          'auto.components.settings.NotificationScopeRules.00ff3e57ce',
          'Saved {{value0}} override (not in current inventory)',
          { value0: rule.selector.level }
        ),
        selector: rule.selector,
        scope: notificationSelectorScope(rule.selector)
      })
    }
  }
  const target =
    options.find((row) => notificationSelectorKey(row.selector) === selected) ?? options[0]
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger variant="row">
        <span className="flex flex-col gap-1">
          <span>
            {t(
              'auto.components.settings.NotificationScopeRules.45d8ddf20a',
              'Project and session rules'
            )}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {t(
              'auto.components.settings.NotificationScopeRules.92f14229ad',
              'Human notifications and manager supervision are independent.'
            )}
          </span>
        </span>
        <ChevronDown className="size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 py-3">
          {loading && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('auto.components.settings.NotificationScopeRules.ef248ecb0b', 'Loading scopes…')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
          >
            {t('auto.components.settings.NotificationScopeRules.e02f161b87', 'Refresh scopes')}
          </Button>
          {target && revision && !loading && (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="notification-scope">
                    {t('auto.components.settings.NotificationScopeRules.e1b3231b99', 'Scope')}
                  </FieldLabel>
                  <Select
                    value={notificationSelectorKey(target.selector)}
                    onValueChange={setSelected}
                  >
                    <SelectTrigger id="notification-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {options.map((row) => (
                          <SelectItem
                            key={notificationSelectorKey(row.selector)}
                            value={notificationSelectorKey(row.selector)}
                          >
                            {row.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel id="notification-audience">
                    {t('auto.components.settings.NotificationScopeRules.0794bbd190', 'Agent role')}
                  </FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={actor}
                    aria-labelledby="notification-audience"
                    className="justify-start"
                    onValueChange={(value) => {
                      if (
                        value === 'any' ||
                        value === 'root' ||
                        value === 'worker' ||
                        value === 'manager'
                      ) {
                        setActor(value)
                      }
                    }}
                  >
                    <ToggleGroupItem value="any">
                      {t('auto.components.settings.NotificationScopeRules.e3fa0227af', 'All roles')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="root">
                      {t(
                        'auto.components.settings.NotificationScopeRules.0c1ad854fb',
                        'Main agent'
                      )}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="worker">
                      {t('auto.components.settings.NotificationScopeRules.fa1418e39e', 'Worker')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="manager">
                      {t('auto.components.settings.NotificationScopeRules.84c7854ae2', 'Manager')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field>
                  <FieldLabel id="notification-destination">
                    {t('auto.components.settings.NotificationScopeRules.2af9cc2669', 'Destination')}
                  </FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={destination}
                    aria-labelledby="notification-destination"
                    className="justify-start"
                    onValueChange={(value) => {
                      if (value === 'both' || value === 'desktop' || value === 'mobile') {
                        setDestination(value)
                      }
                    }}
                  >
                    <ToggleGroupItem value="both">
                      {t(
                        'auto.components.settings.NotificationScopeRules.2ebc15dee6',
                        'Desktop and mobile'
                      )}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="desktop">
                      {t(
                        'auto.components.settings.NotificationScopeRules.796c8f5895',
                        'Desktop / browser'
                      )}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="mobile">
                      {t('auto.components.settings.NotificationScopeRules.17a71cc5c9', 'Mobile')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldGroup>
              <NotificationRuleEditor
                key={JSON.stringify([target.selector, actor, destination, policy])}
                policy={policy}
                target={target}
                actor={actor}
                destination={destination}
                save={onChange}
              />
              <NotificationDeviceRules owner={owner} policy={policy} save={onChange} />
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
