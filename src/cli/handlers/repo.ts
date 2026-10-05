import type { RuntimeRepoList, RuntimeRepoSearchRefs } from '../../shared/runtime-types'
import type { Project } from '../../shared/project-types'
import type { RepoKind } from '../../shared/repo-types'
import type { CommandHandler } from '../dispatch'
import { formatRepoList, formatRepoRefs, formatRepoShow, printResult } from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { resolveRepoPathArgument } from '../repo-path-arguments'
import { RuntimeClientError } from '../runtime/types'

function getOptionalRepoKind(flags: Map<string, string | boolean>): RepoKind | undefined {
  const kind = getOptionalStringFlag(flags, 'kind')
  if (kind === undefined) {
    return undefined
  }
  if (kind === 'git' || kind === 'folder') {
    return kind
  }
  throw new RuntimeClientError('invalid_argument', '--kind must be git or folder')
}

export const REPO_HANDLERS: Record<string, CommandHandler> = {
  'repo list': async ({ client, json }) => {
    const result = await client.call<RuntimeRepoList>('repo.list')
    printResult(result, json, formatRepoList)
  },
  'repo add': async ({ flags, client, cwd, json }) => {
    const repoPath = getRequiredStringFlag(flags, 'path')
    const host = getOptionalStringFlag(flags, 'host')
    const kind = getOptionalRepoKind(flags)
    const projectId = getOptionalStringFlag(flags, 'project')
    let projectUpstream: { owner: string; repo: string } | undefined
    if (projectId) {
      const projects = await client.call<{ projects: Project[] }>('project.list')
      const project = projects.result.projects.find((entry) => entry.id === projectId)
      const identity = project?.providerIdentity
      if (!project) {
        throw new RuntimeClientError('selector_not_found', `Project not found: ${projectId}`)
      }
      if (!identity || identity.provider !== 'github') {
        throw new RuntimeClientError(
          'invalid_argument',
          '--project currently requires a GitHub-backed Orca project'
        )
      }
      projectUpstream = { owner: identity.owner, repo: identity.repo }
    }
    let result = await client.call<{ repo: Record<string, unknown> }>('repo.add', {
      path: resolveRepoPathArgument(repoPath, cwd, client.isRemote, 'Remote repo add'),
      ...(kind ? { kind } : {}),
      ...(host ? { host } : {})
    })
    if (projectUpstream) {
      const repoId = result.result.repo.id
      if (typeof repoId !== 'string' || !repoId) {
        throw new RuntimeClientError('runtime_error', 'Orca did not return the added project ID')
      }
      result = await client.call<{ repo: Record<string, unknown> }>('repo.update', {
        repo: `id:${repoId}`,
        updates: { upstream: projectUpstream }
      })
    }
    printResult(result, json, formatRepoShow)
  },
  'repo show': async ({ flags, client, json }) => {
    const result = await client.call<{ repo: Record<string, unknown> }>('repo.show', {
      repo: getRequiredStringFlag(flags, 'repo')
    })
    printResult(result, json, formatRepoShow)
  },
  'repo set': async ({ flags, client, json }) => {
    const repo = getRequiredStringFlag(flags, 'repo')
    const visibility = getRequiredStringFlag(flags, 'external-worktree-visibility')
    if (visibility !== 'show' && visibility !== 'hide' && visibility !== 'inherit') {
      throw new RuntimeClientError(
        'invalid_argument',
        '--external-worktree-visibility must be show, hide, or inherit.'
      )
    }
    const result = await client.call<{ repo: Record<string, unknown> }>('repo.update', {
      repo,
      updates: { externalWorktreeVisibility: visibility === 'inherit' ? null : visibility }
    })
    printResult(result, json, formatRepoShow)
  },
  'repo set-base-ref': async ({ flags, client, json }) => {
    const result = await client.call<{ repo: Record<string, unknown> }>('repo.setBaseRef', {
      repo: getRequiredStringFlag(flags, 'repo'),
      ref: getRequiredStringFlag(flags, 'ref')
    })
    printResult(result, json, formatRepoShow)
  },
  'repo search-refs': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeRepoSearchRefs>('repo.searchRefs', {
      repo: getRequiredStringFlag(flags, 'repo'),
      query: getRequiredStringFlag(flags, 'query'),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatRepoRefs)
  }
}
