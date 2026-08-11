import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listMulticaIssues, listMulticaProjects, listMulticaWorkspaces } from './cli-client'

let fixtureDirectory = ''

beforeEach(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'orca-multica-cli-'))
  const command = path.join(fixtureDirectory, 'multica-fixture')
  await writeFile(
    command,
    `#!/bin/sh
case "$*" in
  *"workspace list"*) printf '%s' '[{"id":"ws-1","name":"Personal","slug":"personal"}]' ;;
  *"project list"*) printf '%s' '[{"id":"project-1","workspace_id":"ws-1","title":"Aurora","description":null,"status":"in_progress","priority":"high","issue_count":4,"done_count":2,"updated_at":"2026-08-11T00:00:00Z"}]' ;;
  *"issue list"*) printf '%s' '{"issues":[{"id":"issue-1","identifier":"PER-1","workspace_id":"ws-1","project_id":"project-1","title":"Ship integration","description":null,"status":"todo","priority":"high","assignee_id":null,"assignee_type":null,"labels":[],"metadata":{},"updated_at":"2026-08-11T00:00:00Z"}],"total":1,"has_more":false}' ;;
  *) exit 2 ;;
esac
`
  )
  await chmod(command, 0o755)
  process.env.ORCA_MULTICA_COMMAND = command
})

afterEach(async () => {
  delete process.env.ORCA_MULTICA_COMMAND
  await rm(fixtureDirectory, { recursive: true, force: true })
})

describe('Multica CLI client', () => {
  it('parses workspaces and projects from stable JSON output', async () => {
    await expect(listMulticaWorkspaces()).resolves.toEqual([
      { id: 'ws-1', name: 'Personal', slug: 'personal' }
    ])
    await expect(listMulticaProjects('ws-1')).resolves.toEqual([
      expect.objectContaining({ id: 'project-1', title: 'Aurora', issueCount: 4, doneCount: 2 })
    ])
  })

  it('normalizes issue collections', async () => {
    await expect(
      listMulticaIssues({ workspaceId: 'ws-1', projectId: 'project-1' })
    ).resolves.toEqual({
      issues: [
        expect.objectContaining({ id: 'issue-1', identifier: 'PER-1', projectId: 'project-1' })
      ],
      total: 1,
      hasMore: false
    })
  })
})
