import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type {
  MulticaIssue,
  MulticaIssueCollection,
  MulticaProject,
  MulticaWorkspace
} from '../../shared/multica-types'

const execFileAsync = promisify(execFile)
const stringOrNull = z.string().nullable().optional()

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1)
})

const projectSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  title: z.string().min(1),
  description: stringOrNull,
  status: z.string().default('unknown'),
  priority: z.string().default('none'),
  issue_count: z.number().int().nonnegative().default(0),
  done_count: z.number().int().nonnegative().default(0),
  updated_at: z.string().default('')
})

const labelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().default('')
})

const issueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  workspace_id: z.string().min(1),
  project_id: stringOrNull,
  title: z.string().min(1),
  description: stringOrNull,
  status: z.string().default('unknown'),
  priority: z.string().default('none'),
  assignee_id: stringOrNull,
  assignee_type: stringOrNull,
  labels: z.array(labelSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  updated_at: z.string().default('')
})

const issueCollectionSchema = z.object({
  issues: z.array(issueSchema),
  total: z.number().int().nonnegative().default(0),
  has_more: z.boolean().default(false)
})

export async function listMulticaWorkspaces(): Promise<MulticaWorkspace[]> {
  return z.array(workspaceSchema).parse(await runMultica(['workspace', 'list', '--output', 'json']))
}

export async function listMulticaProjects(workspaceId?: string): Promise<MulticaProject[]> {
  const rows = z
    .array(projectSchema)
    .parse(await runMultica([...workspaceArgs(workspaceId), 'project', 'list', '--output', 'json']))
  return rows.map((project) => ({
    id: project.id,
    workspaceId: project.workspace_id,
    title: project.title,
    description: project.description ?? null,
    status: project.status,
    priority: project.priority,
    issueCount: project.issue_count,
    doneCount: project.done_count,
    updatedAt: project.updated_at
  }))
}

export async function listMulticaIssues(args: {
  workspaceId?: string
  projectId?: string
  status?: string
  limit?: number
}): Promise<MulticaIssueCollection> {
  const command = [...workspaceArgs(args.workspaceId), 'issue', 'list']
  if (args.projectId) {
    command.push('--project', args.projectId)
  }
  if (args.status) {
    command.push('--status', args.status)
  }
  command.push('--limit', String(Math.min(Math.max(args.limit ?? 100, 1), 200)), '--output', 'json')
  const result = issueCollectionSchema.parse(await runMultica(command))
  return {
    issues: result.issues.map(mapIssue),
    total: result.total,
    hasMore: result.has_more
  }
}

function mapIssue(issue: z.infer<typeof issueSchema>): MulticaIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    workspaceId: issue.workspace_id,
    projectId: issue.project_id ?? null,
    title: issue.title,
    description: issue.description ?? null,
    status: issue.status,
    priority: issue.priority,
    assigneeId: issue.assignee_id ?? null,
    assigneeType: issue.assignee_type ?? null,
    labels: issue.labels,
    metadata: issue.metadata,
    updatedAt: issue.updated_at
  }
}

function workspaceArgs(workspaceId?: string): string[] {
  return workspaceId ? ['--workspace-id', workspaceId] : []
}

async function runMultica(args: string[]): Promise<unknown> {
  const command = process.env.ORCA_MULTICA_COMMAND?.trim() || 'multica'
  const { stdout } = await execFileAsync(command, args, {
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8'
  })
  return JSON.parse(stdout)
}
