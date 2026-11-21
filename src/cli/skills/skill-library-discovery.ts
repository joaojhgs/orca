import type { HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag } from '../arguments/flags'
import { resolveHostFlagTarget } from '../hosts/execution-host-flag'
import { RuntimeClientError } from '../runtime/connection/types'
import { readOrchestrationCompatibilityEvidence } from '../../shared/orchestration/orchestration-compatibility-evidence'
import { toSshExecutionHostId } from '../../shared/execution-host/execution-host'
import type { SkillLibraryCandidate } from '../../shared/skill-library-contract'

export async function resolveSkillLibraryHost(ctx: HandlerContext): Promise<string> {
  const selected = await resolveHostFlagTarget(ctx.flags, ctx.client)
  if (selected) {
    return selected.kind === 'runtime' ? 'local' : selected.id
  }
  const caller = readOrchestrationCompatibilityEvidence(process.env)?.host
  return caller?.kind === 'ssh' ? toSshExecutionHostId(caller.targetId) : 'local'
}

export async function selectSkillLibraryCandidates(ctx: HandlerContext) {
  const hostId = await resolveSkillLibraryHost(ctx)
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
