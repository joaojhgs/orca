import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus, RefreshCw, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { useActiveRuntimeOwnerTarget } from '@/hooks/use-active-runtime-owner-target'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { ManagerObjectiveForm } from './ManagerObjectiveForm'
import { ManagerReplyForm } from './ManagerReplyForm'
import { ManagerTranscript } from './ManagerTranscript'
import { useManagerConversations } from './use-manager-conversations'
import { managerWorkspaceChoices } from './manager-workspace-choices'

export default function ManagerPage(): React.JSX.Element {
  const target = useActiveRuntimeOwnerTarget()
  const revision = useAppStore((state) =>
    target?.kind === 'environment'
      ? (() => {
          const environment = state.runtimeEnvironments.find(
            (entry) => entry.id === target.environmentId
          )
          return environment?.pairingRevision ?? environment?.createdAt
        })()
      : null
  )
  if (!target) {
    return <p role="status">{translate('manager.resolvingOwner', 'Resolving the Orca server…')}</p>
  }
  const key = target.kind === 'environment' ? `${target.environmentId}:${revision ?? ''}` : 'local'
  return <ManagerRuntimePage key={key} target={target} ownerKey={key} />
}

function ManagerRuntimePage({
  target,
  ownerKey
}: {
  target: RuntimeClientTarget
  ownerKey: string
}): React.JSX.Element {
  const page = useManagerConversations(target, ownerKey)
  const close = useAppStore((state) => state.closeManagerPage)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const workspaceState = useAppStore(
    useShallow((state) => ({
      repos: state.repos,
      worktreesByRepo: state.worktreesByRepo,
      folderWorkspaces: state.folderWorkspaces,
      projectGroups: state.projectGroups
    }))
  )
  const initialWorkspaceId = useAppStore(
    (state) => getActiveSidebarWorkspaceId(state.activeWorkspaceKey, state.activeWorktreeId) ?? ''
  )
  const workspaces = useMemo(
    () => managerWorkspaceChoices(workspaceState, target),
    [workspaceState, target]
  )
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<{ runId: string; messageId: string } | null>(null)
  const replyTo = answer?.runId === page.runId ? answer.messageId : null
  const principal = page.catalog?.principals.find((entry) => entry.id === page.detail?.principalId)
  const canReply = principal?.state === 'active' && principal.actions.includes('inventory:read')
  const disabled = page.busy || Boolean(page.pending) || page.recoveryBlocked
  const t = translate
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <header
        className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3"
        style={
          sidebarOpen ? { paddingRight: 'max(1rem, var(--window-controls-width, 0px))' } : undefined
        }
      >
        <h1 className="text-sm font-medium">{t('manager.title', 'Hermes manager')}</h1>
        {principal ? (
          <Badge variant="outline">
            {principal.state !== 'active'
              ? principal.state
              : principal.consumerConnected
                ? t('manager.connected', 'Consumer connected')
                : t('manager.offline', 'Consumer offline')}
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => page.select(null)} disabled={disabled}>
            <Plus data-icon="inline-start" />
            {t('manager.new', 'New objective')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void page.refresh()}
            disabled={page.busy}
          >
            <RefreshCw data-icon="inline-start" />
            {t('manager.refresh', 'Refresh')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={close}
                aria-label={t('manager.close', 'Close manager')}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('manager.close', 'Close manager')}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      {page.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('manager.requestFailed', 'Manager request failed')}</AlertTitle>
          <AlertDescription>{page.error}</AlertDescription>
        </Alert>
      ) : null}
      {page.pending ? (
        <Alert>
          <AlertTitle>{t('manager.unconfirmed', 'Request not confirmed')}</AlertTitle>
          <AlertDescription>
            {t(
              'manager.retryHelp',
              'Retry the same request to reconcile it safely. Do not send another copy.'
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={page.busy}
              onClick={() => void page.retry()}
            >
              {t('manager.retry', 'Retry same request')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {page.notice ? (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          {page.notice}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label={t('manager.objectives', 'Manager objectives')}
          className="flex max-h-48 min-h-0 flex-col gap-2 border-b border-border p-3 md:max-h-none md:w-64 md:shrink-0 md:border-r md:border-b-0"
        >
          <Input
            aria-label={t('manager.search', 'Search objectives')}
            placeholder={t('manager.search', 'Search objectives')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1">
              {page.catalog?.conversations
                .filter((entry) => entry.objective.toLowerCase().includes(query.toLowerCase()))
                .map((entry) => (
                  <Button
                    key={entry.runId}
                    variant={entry.runId === page.runId ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-auto w-full justify-start whitespace-normal text-left"
                    disabled={page.busy}
                    aria-current={entry.runId === page.runId ? 'page' : undefined}
                    onClick={() => page.select(entry.runId)}
                  >
                    <span className="line-clamp-3">{entry.objective}</span>
                  </Button>
                ))}
              {page.catalog?.nextOffset != null ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page.busy}
                  onClick={() => void page.moreConversations()}
                >
                  {t('manager.moreObjectives', 'Load more objectives')}
                </Button>
              ) : null}
            </div>
          </ScrollArea>
        </nav>
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={t('manager.conversation', 'Manager conversation')}
        >
          {page.runId ? (
            page.detail ? (
              <>
                <ManagerTranscript
                  key={page.runId}
                  messages={page.detail.messages}
                  busy={disabled}
                  canReply={canReply}
                  hasMore={page.detail.hasMore}
                  onMore={() => void page.loadMore()}
                  onAnswer={(messageId) => {
                    if (page.runId) {
                      setAnswer({ runId: page.runId, messageId })
                    }
                  }}
                />
                <ManagerReplyForm
                  key={page.runId}
                  disabled={disabled || !canReply || page.detail.hasMore}
                  replyTo={replyTo}
                  onCancelAnswer={() => setAnswer(null)}
                  onSend={async (body, reply) => {
                    const accepted = await page.send(body, reply)
                    if (accepted) {
                      setAnswer(null)
                    }
                    return accepted
                  }}
                />
              </>
            ) : (
              <p role="status">{t('manager.loadingConversation', 'Loading conversation…')}</p>
            )
          ) : page.catalog?.principals.some(
              (entry) => entry.state === 'active' && entry.actions.includes('run:create')
            ) ? (
            <ScrollArea className="min-h-0 flex-1">
              <ManagerObjectiveForm
                principals={page.catalog.principals}
                workspaces={workspaces}
                initialWorkspaceId={initialWorkspaceId}
                disabled={disabled}
                onCreate={page.create}
              />
            </ScrollArea>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {page.busy
                    ? t('manager.loading', 'Loading managers…')
                    : t('manager.notConfigured', 'No active manager configured')}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    'manager.setupHelp',
                    'An owner must issue a scoped manager credential and start its consumer on the coding worker. An older Orca server may need an update. Hermes does not run on this controller.'
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>
    </main>
  )
}
