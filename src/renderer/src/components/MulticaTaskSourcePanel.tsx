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
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { MulticaIcon } from '@/components/task-page-localized-options'
import { cn } from '@/lib/utils'

const ALL = 'all'
const ISSUE_LIMIT = 200

export function MulticaTaskSourcePanel(): React.JSX.Element {
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const selectedWorkspace = workspaceId === ALL ? undefined : workspaceId
      const [nextWorkspaces, nextProjects, nextIssues] = await Promise.all([
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
      setWorkspaces(nextWorkspaces)
      setProjects(nextProjects)
      setIssues(nextIssues)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Multica tasks.')
    } finally {
      setLoading(false)
    }
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
          <span className="text-sm font-medium">Multica</span>
        </div>
        <Select
          value={workspaceId}
          onValueChange={(value) => {
            setWorkspaceId(value)
            setProjectId(ALL)
          }}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All workspaces</SelectItem>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="backlog">Backlog</SelectItem>
            <SelectItem value="todo">Todo</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter Multica issues…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setRefreshToken((value) => value + 1)}
          disabled={loading}
          aria-label="Refresh Multica"
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </div>

      <div className="grid h-8 flex-none grid-cols-[100px_minmax(260px,2fr)_minmax(140px,1fr)_110px_100px] items-center gap-3 border-b border-border/50 bg-muted/25 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <span>ID</span>
        <span>Title</span>
        <span>Project</span>
        <span>Status</span>
        <span>Updated</span>
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
            <p className="text-sm">No Multica issues match these filters.</p>
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
                ? (projectById.get(issue.projectId)?.title ?? 'Unknown project')
                : 'No project'}
            </span>
            <span
              className={cn(
                'w-fit rounded-full border border-border/50 px-2 py-0.5 text-[10px]',
                issue.status === 'done' && 'text-emerald-600 dark:text-emerald-400',
                issue.status === 'in_progress' && 'text-blue-600 dark:text-blue-400'
              )}
            >
              {issue.status.replaceAll('_', ' ')}
            </span>
            <span className="text-[11px] text-muted-foreground">{formatDate(issue.updatedAt)}</span>
          </div>
        ))}
      </div>
      <div className="flex h-9 flex-none items-center justify-between border-t border-border/50 px-3 text-[11px] text-muted-foreground">
        <span>
          {visibleIssues.length} shown · {issues.total} total
        </span>
        {issues.hasMore ? (
          <span>Showing the first {ISSUE_LIMIT}; narrow the filters for more.</span>
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

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
