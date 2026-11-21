import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderKanban, LoaderCircle, RefreshCw, Search } from 'lucide-react'

import type {
  MulticaIssueCollection,
  MulticaProject,
  MulticaWorkspace
} from '../../../shared/multica-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { MulticaIcon } from '@/components/task-page/task-page-localized-options'
import { cn } from '@/lib/class-names'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'

const ALL = 'all'
const ISSUE_LIMIT = 200

function fetchMulticaTasks(workspaceId: string, projectId: string, status: string) {
  const selectedWorkspace = workspaceId === ALL ? undefined : workspaceId
  return Promise.all([
    callRuntimeRpc<MulticaWorkspace[]>({ kind: 'local' }, 'multica.listWorkspaces'),
    callRuntimeRpc<MulticaProject[]>({ kind: 'local' }, 'multica.listProjects', {
      workspaceId: selectedWorkspace
    }),
    callRuntimeRpc<MulticaIssueCollection>({ kind: 'local' }, 'multica.listIssues', {
      workspaceId: selectedWorkspace,
      projectId: projectId === ALL ? undefined : projectId,
      status: status === ALL ? undefined : status,
      limit: ISSUE_LIMIT
    })
  ])
}

export function MulticaTaskSourcePanel(): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const [workspaces, setWorkspaces] = useState<MulticaWorkspace[]>([])
  const [projects, setProjects] = useState<MulticaProject[]>([])
  const [issues, setIssues] = useState<MulticaIssueCollection>({
    issues: [],
    total: 0,
    hasMore: false
  })
  const [workspaceId, setWorkspaceId] = useState(ALL)
  const [projectId, setProjectId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchMulticaTasks(workspaceId, projectId, status)
      .then(([nextWorkspaces, nextProjects, nextIssues]) => {
        setWorkspaces(nextWorkspaces)
        setProjects(nextProjects)
        setIssues(nextIssues)
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load Multica tasks.')
      })
      .finally(() => setLoading(false))
  }, [projectId, status, workspaceId])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  useEffect(() => {
    if (projectId !== ALL && !projects.some((project) => project.id === projectId)) {
      setProjectId(ALL)
    }
  }, [projectId, projects])

  const visibleIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) {
      return issues.issues
    }
    return issues.issues.filter((issue) =>
      [
        issue.identifier,
        issue.title,
        issue.description ?? '',
        ...issue.labels.map((label) => label.name)
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
  }, [issues.issues, query])

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-muted/40 p-3">
        <div className="flex min-w-0 items-center gap-2 pr-2">
          <MulticaIcon className="size-5 text-foreground" />
          <span className="text-sm font-medium">
            {t('auto.components.MulticaTaskSourcePanel.0fb3e3f5e7', 'Multica')}
          </span>
        </div>
        <Select
          value={workspaceId}
          onValueChange={(value) => {
            setWorkspaceId(value)
            setProjectId(ALL)
          }}
        >
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue
              placeholder={t('auto.components.MulticaTaskSourcePanel.ddd6a8cd3a', 'Workspace')}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>
                {t('auto.components.MulticaTaskSourcePanel.5a41f9ba1c', 'All workspaces')}
              </SelectItem>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-8 w-[200px]">
            <SelectValue
              placeholder={t('auto.components.MulticaTaskSourcePanel.dc5e16cd3b', 'Project')}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>
                {t('auto.components.MulticaTaskSourcePanel.98d9e76d06', 'All projects')}
              </SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue
              placeholder={t('auto.components.MulticaTaskSourcePanel.e50fe52652', 'Status')}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>
                {t('auto.components.MulticaTaskSourcePanel.f12f9a0738', 'All statuses')}
              </SelectItem>
              <SelectItem value="backlog">
                {t('auto.components.MulticaTaskSourcePanel.ce9d35d596', 'Backlog')}
              </SelectItem>
              <SelectItem value="todo">
                {t('auto.components.MulticaTaskSourcePanel.cc710f762e', 'Todo')}
              </SelectItem>
              <SelectItem value="in_progress">
                {t('auto.components.MulticaTaskSourcePanel.7acfb59f98', 'In progress')}
              </SelectItem>
              <SelectItem value="done">
                {t('auto.components.MulticaTaskSourcePanel.d5667e8063', 'Done')}
              </SelectItem>
              <SelectItem value="canceled">
                {t('auto.components.MulticaTaskSourcePanel.f896d6205b', 'Canceled')}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(
              'auto.components.MulticaTaskSourcePanel.7240a75ee3',
              'Filter Multica issues…'
            )}
            className="h-8"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setRefreshToken((value) => value + 1)}
          disabled={loading}
          aria-label={t('auto.components.MulticaTaskSourcePanel.89f0cd04e6', 'Refresh Multica')}
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </div>

      <div className="grid h-8 flex-none grid-cols-[100px_minmax(260px,2fr)_minmax(140px,1fr)_110px_100px] items-center gap-3 border-b border-border/50 bg-muted/25 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <span>{t('auto.components.MulticaTaskSourcePanel.c8cfa92670', 'ID')}</span>
        <span>{t('auto.components.MulticaTaskSourcePanel.5f9d1fc767', 'Title')}</span>
        <span>{t('auto.components.MulticaTaskSourcePanel.dc5e16cd3b', 'Project')}</span>
        <span>{t('auto.components.MulticaTaskSourcePanel.e50fe52652', 'Status')}</span>
        <span>{t('auto.components.MulticaTaskSourcePanel.b52b6fe3cd', 'Updated')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
        {error ? (
          <div className="border-b border-border/50 px-4 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {!error && loading && issues.issues.length === 0 ? <LoadingRows /> : null}
        {!error && !loading && visibleIssues.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center text-muted-foreground">
            <FolderKanban className="mb-3 size-8 opacity-50" />
            <p className="text-sm">
              {t(
                'auto.components.MulticaTaskSourcePanel.ea5cd457ab',
                'No Multica issues match these filters.'
              )}
            </p>
          </div>
        ) : null}
        {visibleIssues.map((issue) => (
          <div
            key={issue.id}
            className="grid min-h-12 grid-cols-[100px_minmax(260px,2fr)_minmax(140px,1fr)_110px_100px] items-center gap-3 border-b border-border/40 px-3 py-2 text-xs hover:bg-muted/30"
          >
            <span className="font-mono text-[11px] text-muted-foreground">{issue.identifier}</span>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{issue.title}</div>
              <div className="mt-1 flex gap-1 overflow-hidden">
                {issue.labels.slice(0, 4).map((label) => (
                  <span
                    key={label.id}
                    className="truncate rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
            <span className="truncate text-muted-foreground">
              {issue.projectId
                ? (projectById.get(issue.projectId)?.title ??
                  t('auto.components.MulticaTaskSourcePanel.0d05e0f742', 'Unknown project'))
                : t('auto.components.MulticaTaskSourcePanel.d1e58fdf8e', 'No project')}
            </span>
            <span
              className={cn(
                'w-fit rounded-full border border-border/50 px-2 py-0.5 text-[10px]',
                issue.status === 'done' && 'text-status-success',
                issue.status === 'in_progress' && 'text-ai-action-accent'
              )}
            >
              {issue.status.replaceAll('_', ' ')}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatDate(issue.updatedAt, intlLocale)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex h-9 flex-none items-center justify-between border-t border-border/50 px-3 text-[11px] text-muted-foreground">
        <span>
          {t(
            'auto.components.MulticaTaskSourcePanel.visibleCount',
            '{{shown}} shown · {{total}} total',
            {
              shown: visibleIssues.length,
              total: issues.total
            }
          )}
        </span>
        {issues.hasMore ? (
          <span>
            {t(
              'auto.components.MulticaTaskSourcePanel.limitNotice',
              'Showing the first {{limit}}; narrow the filters for more.',
              { limit: ISSUE_LIMIT }
            )}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function LoadingRows(): React.JSX.Element {
  return (
    <div className="divide-y divide-border/40">
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          className="grid h-12 grid-cols-[100px_minmax(260px,2fr)_minmax(140px,1fr)_110px_100px] items-center gap-3 px-3"
        >
          <span className="h-3 animate-pulse rounded bg-muted" />
          <span className="h-3 animate-pulse rounded bg-muted" />
          <span className="h-3 animate-pulse rounded bg-muted" />
          <span className="h-3 animate-pulse rounded bg-muted" />
          <span className="h-3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function formatDate(value: string, intlLocale: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(intlLocale, { month: 'short', day: 'numeric' })
}
