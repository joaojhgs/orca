import { z } from 'zod'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  SkillLibraryCandidateSchema,
  type SkillLibraryCandidate,
  type SkillLibrarySnapshot
} from '../../../../shared/skill-library-contract'

export type HostedSkillCandidate = SkillLibraryCandidate & { hostId: string; hostLabel: string }

export async function discoverSkillLibraryHosts(
  target: RuntimeClientTarget,
  hosts: SkillLibrarySnapshot['hosts'],
  scope: string
): Promise<{ candidates: HostedSkillCandidate[]; issues: string[] }> {
  const candidates: HostedSkillCandidate[] = []
  const issues: string[] = []
  // Serial scans bound resource use even when several distroboxes share one machine.
  for (const host of hosts.filter((host) => scope === 'all' || host.id === scope)) {
    if (!host.reachable) {
      issues.push(`${host.label}: unavailable`)
      continue
    }
    try {
      const result = z
        .object({ candidates: z.array(SkillLibraryCandidateSchema) })
        .parse(
          await callRuntimeRpc(
            target,
            'skills.library.discover',
            { hostId: host.id },
            { timeoutMs: 120000 }
          )
        )
      candidates.push(
        ...result.candidates.map((candidate) => ({
          ...candidate,
          hostId: host.id,
          hostLabel: host.label
        }))
      )
    } catch (error) {
      issues.push(`${host.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { candidates, issues }
}
