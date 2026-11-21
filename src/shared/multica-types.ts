export type MulticaWorkspace = {
  id: string
  name: string
  slug: string
}

export type MulticaProject = {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: string
  priority: string
  issueCount: number
  doneCount: number
  updatedAt: string
}

export type MulticaIssueLabel = {
  id: string
  name: string
  color: string
}

export type MulticaIssue = {
  id: string
  identifier: string
  workspaceId: string
  projectId: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assigneeId: string | null
  assigneeType: string | null
  labels: MulticaIssueLabel[]
  metadata: Record<string, unknown>
  updatedAt: string
}

export type MulticaIssueCollection = {
  issues: MulticaIssue[]
  total: number
  hasMore: boolean
}
