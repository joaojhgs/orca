import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { resolveHostFlagTarget } from '../execution-host-flag'
import { RuntimeClientError } from '../runtime/types'
import { readOrchestrationCompatibilityEvidence } from '../../shared/orchestration-compatibility-evidence'
import { toSshExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import type {
  SkillLibraryCandidate,
  SkillLibrarySnapshot
} from '../../shared/skill-library-contract'
import type { SkillInstallDestination } from '../../shared/skill-install-contract'
import { selectImportedPluginVersions } from './skill-library-plugin-selection'
import { skillLibraryDestinationKey } from '../../shared/skill-library-destination-key'

async function callerHost(ctx: HandlerContext): Promise<string> {
  const selected = await resolveHostFlagTarget(ctx.flags, ctx.client)
  if (selected) {
    return selected.kind === 'runtime' ? 'local' : selected.id
  }
  const caller = readOrchestrationCompatibilityEvidence(process.env)?.host
  return caller?.kind === 'ssh' ? toSshExecutionHostId(caller.targetId) : 'local'
}

async function selectedCandidates(ctx: HandlerContext) {
  const hostId = await callerHost(ctx)
  const response = await ctx.client.call<{ candidates: SkillLibraryCandidate[] }>(
    'skills.library.discover',
    { hostId },
    { timeoutMs: 120000 }
  )
  const selectors = getRepeatedStringFlag(ctx.flags, 'skill')
  const plugins = getRepeatedStringFlag(ctx.flags, 'plugin')
  if (!selectors.length && !plugins.length) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Select --skill or --plugin from skills library discover.'
    )
  }
  const candidates = selectors.map((selector) => {
    const exact = response.result.candidates.find((row) => row.id === selector)
    const matches = exact
      ? [exact]
      : response.result.candidates.filter((row) => row.name === selector)
    if (matches.length !== 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Skill selector is missing or ambiguous: ${selector}. Use an exact discovery ID.`
      )
    }
    return matches[0]
  })
  for (const selector of plugins) {
    const requestedVersion = getOptionalStringFlag(ctx.flags, 'plugin-version')
    const matches = response.result.candidates.filter(
      (row) =>
        row.plugin &&
        (row.plugin.id === selector || row.plugin.name === selector) &&
        (!requestedVersion || row.plugin.version === requestedVersion)
    )
    if (!matches.length || new Set(matches.map((row) => row.plugin!.id)).size !== 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Plugin is missing or ambiguous: ${selector}. Use its exact plugin ID.`
      )
    }
    if (new Set(matches.map((row) => row.plugin?.version ?? 'unknown')).size > 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Multiple cached plugin versions were found. Choose --plugin-version explicitly.'
      )
    }
    candidates.push(...matches)
  }
  const excluded = getRepeatedStringFlag(ctx.flags, 'exclude-skill')
  const selection = [...new Map(candidates.map((row) => [row.id, row])).values()].filter(
    (row) => !excluded.includes(row.id) && !excluded.includes(row.name)
  )
  if (!selection.length || selection.length > 50) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Select between one and 50 skills; use --exclude-skill to narrow a plugin.'
    )
  }
  return { hostId, candidates: selection }
}

async function printCall(ctx: HandlerContext, method: string, params?: unknown) {
  const response = await ctx.client.call(method, params, { timeoutMs: 10 * 60 * 1000 })
  printResult(response, ctx.json, (result) => JSON.stringify(result, null, 2))
}

async function scopedAssignments(ctx: HandlerContext) {
  if (ctx.flags.has('host') && ctx.flags.has('all-hosts')) {
    throw new RuntimeClientError('invalid_argument', 'Use either --host or --all-hosts.')
  }
  const hostId = ctx.flags.has('all-hosts') ? null : await callerHost(ctx)
  const catalog = await ctx.client.call<SkillLibrarySnapshot>('skills.library.list')
  const id = getOptionalStringFlag(ctx.flags, 'assignment-id')
  const rows = catalog.result.assignments.filter(
    (row) => (!hostId || row.executionHostId === hostId) && (!id || row.id === id)
  )
  if (id && !rows.length) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Assignment not found in the selected host scope. Select its --host or use --all-hosts explicitly.'
    )
  }
  return { rows, catalog }
}

export const SKILL_LIBRARY_HANDLERS: Record<string, CommandHandler> = {
  'skills library list': async (ctx) => {
    if (ctx.flags.has('all-hosts') && ctx.flags.has('host')) {
      throw new RuntimeClientError('invalid_argument', 'Use either --host or --all-hosts.')
    }
    const hostId = ctx.flags.has('all-hosts') ? null : await callerHost(ctx)
    const response = await ctx.client.call<SkillLibrarySnapshot>('skills.library.list')
    const result = {
      ...response,
      result: {
        ...response.result,
        assignments: response.result.assignments.filter(
          (row) => !hostId || row.executionHostId === hostId
        ),
        scope: { executionHostId: hostId, mode: hostId ? 'host' : 'all' }
      }
    }
    printResult(
      result,
      ctx.json,
      (catalog) =>
        `${catalog.versions.length} library versions; ${catalog.assignments.length} assignments\n${catalog.assignments.map((row) => `${row.id} ${row.status} ${row.executionHostId} ${row.providers.join(', ')}${row.message ? `: ${row.message}` : ''}`).join('\n')}`
    )
  },
  'skills library discover': async (ctx) =>
    printCall(ctx, 'skills.library.discover', { hostId: await callerHost(ctx) }),
  'skills library preview': async (ctx) => {
    const selection = await selectedCandidates(ctx)
    if (selection.candidates.length !== 1) {
      throw new RuntimeClientError('invalid_argument', 'Preview exactly one --skill.')
    }
    await printCall(ctx, 'skills.library.preview', {
      hostId: selection.hostId,
      candidateId: selection.candidates[0].id,
      filePath: getOptionalStringFlag(ctx.flags, 'file')
    })
  },
  'skills library import': async (ctx) => {
    if (!ctx.flags.has('reviewed')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Review the files with skills library preview before importing; acknowledge with --reviewed.'
      )
    }
    const selection = await selectedCandidates(ctx)
    const digest = getOptionalStringFlag(ctx.flags, 'expected-digest')
    if (digest && selection.candidates.length !== 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--expected-digest requires exactly one --skill.'
      )
    }
    await printCall(ctx, 'skills.library.import', {
      hostId: selection.hostId,
      candidateIds: selection.candidates.map((row) => row.id),
      reviewed: true,
      addVersion: ctx.flags.has('add-version'),
      ...(digest
        ? { expectedDigests: [{ candidateId: selection.candidates[0].id, packageDigest: digest }] }
        : {})
    })
  },
  'skills library assign': async (ctx) => {
    const hostId = await callerHost(ctx)
    const worktreeId = getOptionalStringFlag(ctx.flags, 'worktree-id')
    const folderWorkspaceId = getOptionalStringFlag(ctx.flags, 'folder-id')
    if (worktreeId && folderWorkspaceId) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Choose either --worktree-id or --folder-id.'
      )
    }
    const host = parseExecutionHostId(hostId)
    let destination: SkillInstallDestination
    if (worktreeId || folderWorkspaceId) {
      const catalog = await ctx.client.call<SkillLibrarySnapshot>('skills.library.list')
      const workspace = catalog.result.workspaces.find(
        (row) =>
          row.id === (worktreeId ?? folderWorkspaceId) &&
          row.kind === (worktreeId ? 'worktree' : 'folder')
      )
      if (!workspace || workspace.hostId !== hostId) {
        throw new RuntimeClientError(
          'invalid_argument',
          'Workspace does not belong to the selected execution host. Select its --host explicitly.'
        )
      }
      destination = { scope: 'workspace', ...(worktreeId ? { worktreeId } : { folderWorkspaceId }) }
    } else {
      destination = {
        scope: 'global',
        executionTarget:
          host?.kind === 'ssh' ? { kind: 'ssh', connectionId: host.targetId } : { kind: 'host' }
      }
    }
    const providers = getRequiredStringFlag(ctx.flags, 'agent')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const pluginSelector = getOptionalStringFlag(ctx.flags, 'plugin')
    const versionId = getOptionalStringFlag(ctx.flags, 'version-id')
    if (Boolean(pluginSelector) === Boolean(versionId)) {
      throw new RuntimeClientError('invalid_argument', 'Choose either --version-id or --plugin.')
    }
    if (!pluginSelector) {
      await printCall(ctx, 'skills.library.assign', { versionId, destination, providers })
      return
    }
    const catalog = await ctx.client.call<SkillLibrarySnapshot>('skills.library.list')
    const versions = selectImportedPluginVersions(
      catalog.result.versions,
      pluginSelector,
      getRepeatedStringFlag(ctx.flags, 'exclude-skill')
    )
    const assignments: unknown[] = []
    for (const version of versions) {
      const existing = catalog.result.assignments.find(
        (row) =>
          row.packageId === version.packageId &&
          row.executionHostId === hostId &&
          row.status !== 'removed' &&
          skillLibraryDestinationKey({
            ...row.destination,
            ...(row.destination.scope === 'global' ? { environmentId: undefined } : {})
          }) === skillLibraryDestinationKey(destination)
      )
      const response = await ctx.client.call(
        'skills.library.assign',
        {
          versionId: version.versionId,
          destination,
          providers: [...new Set([...providers, ...(existing?.providers ?? [])])]
        },
        { timeoutMs: 600000 }
      )
      assignments.push(response.result)
    }
    printResult({ ...catalog, result: { assignments } }, ctx.json, (result) =>
      JSON.stringify(result, null, 2)
    )
  },
  'skills library share': async (ctx) => {
    if (!ctx.flags.has('reviewed')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Review imported snapshots and acknowledge with --reviewed before sharing.'
      )
    }
    const plugin = getOptionalStringFlag(ctx.flags, 'plugin')
    const ids = getRepeatedStringFlag(ctx.flags, 'version-id')
    if (Boolean(plugin) === Boolean(ids.length)) {
      throw new RuntimeClientError('invalid_argument', 'Choose either --plugin or --version-id.')
    }
    if (plugin) {
      const catalog = await ctx.client.call<SkillLibrarySnapshot>('skills.library.list')
      ids.push(
        ...selectImportedPluginVersions(
          catalog.result.versions,
          plugin,
          getRepeatedStringFlag(ctx.flags, 'exclude-skill')
        ).map((row) => row.versionId)
      )
    }
    await printCall(ctx, 'skills.library.share', {
      versionIds: ids,
      bundleName: getRequiredStringFlag(ctx.flags, 'bundle-name'),
      reviewed: true
    })
  },
  'skills library unassign': async (ctx) => {
    getRequiredStringFlag(ctx.flags, 'assignment-id')
    const {
      rows: [row]
    } = await scopedAssignments(ctx)
    await printCall(ctx, 'skills.library.unassign', { assignmentId: row.id })
  },
  'skills library reconcile': async (ctx) => {
    const { rows, catalog } = await scopedAssignments(ctx)
    const results: unknown[] = []
    for (const row of rows) {
      results.push(
        (
          await ctx.client.call(
            'skills.library.reconcile',
            { assignmentId: row.id },
            { timeoutMs: 600000 }
          )
        ).result
      )
    }
    printResult({ ...catalog, result: { results } }, ctx.json, (result) =>
      JSON.stringify(result, null, 2)
    )
  },
  'skills library delete': async (ctx) =>
    printCall(ctx, 'skills.library.deleteVersion', {
      versionId: getRequiredStringFlag(ctx.flags, 'version-id')
    })
}
