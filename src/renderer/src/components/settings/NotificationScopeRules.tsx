import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { NotificationScopePolicy } from '../../../../shared/notification-scope-policy'
import {
  notificationSelectorKey,
  notificationSelectorScope,
  type NotificationPolicyTarget
} from '../../../../shared/notification-policy-target'
import { useAppStore } from '@/store'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
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

const emptyPolicy: NotificationScopePolicy = { rules: [], deviceOverrides: [] }

export function NotificationScopeRules(): React.JSX.Element {
  const environmentId = useAppStore((s) => s.settings?.activeRuntimeEnvironmentId)
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
  const currentOwner = useRef(environmentId)
  currentOwner.current = environmentId
  async function onChange(next: NotificationScopePolicy): Promise<void> {
    if (!revision || saving.current) {
      throw new Error('Refresh scopes or wait for the current policy save before retrying.')
    }
    saving.current = true
    try {
      const saved = await callRuntimeRpc<{ policy: NotificationScopePolicy; revision: string }>(
        getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId ?? null }),
        'notifications.policyUpdate',
        { policy: next, expectedRevision: revision }
      )
      if (currentOwner.current !== environmentId) {
        throw new Error(
          'Policy saved on the previous server. Refresh the current server before editing.'
        )
      }
      setPolicy(saved.policy)
      setRevision(saved.revision)
    } finally {
      saving.current = false
    }
  }
  useEffect(() => {
    if (!open) {
      return
    }
    const controller = new AbortController()
    setTargets([])
    setPolicy(emptyPolicy)
    setRevision(null)
    setLoading(true)
    setError(null)
    void (async () => {
      const saved = await callRuntimeRpc<{ policy: NotificationScopePolicy; revision: string }>(
        getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId ?? null }),
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
          getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId ?? null }),
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
        label: `Saved ${rule.selector.level} override (not in current inventory)`,
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
          <span>Project and session rules</span>
          <span className="text-xs font-normal text-muted-foreground">
            Human notifications and manager supervision are independent.
          </span>
        </span>
        <ChevronDown className="size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 py-3">
          {loading && (
            <p role="status" className="text-xs text-muted-foreground">
              Loading scopes…
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
            Refresh scopes
          </Button>
          {target && revision && !loading && (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="notification-scope">Scope</FieldLabel>
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
                  <FieldLabel id="notification-audience">Agent role</FieldLabel>
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
                    <ToggleGroupItem value="any">All roles</ToggleGroupItem>
                    <ToggleGroupItem value="root">Main agent</ToggleGroupItem>
                    <ToggleGroupItem value="worker">Worker</ToggleGroupItem>
                    <ToggleGroupItem value="manager">Manager</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field>
                  <FieldLabel id="notification-destination">Destination</FieldLabel>
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
                    <ToggleGroupItem value="both">Desktop and mobile</ToggleGroupItem>
                    <ToggleGroupItem value="desktop">Desktop / browser</ToggleGroupItem>
                    <ToggleGroupItem value="mobile">Mobile</ToggleGroupItem>
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
              <NotificationDeviceRules
                owner={getActiveRuntimeTarget({
                  activeRuntimeEnvironmentId: environmentId ?? null
                })}
                policy={policy}
                save={onChange}
              />
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
