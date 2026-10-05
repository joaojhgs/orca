import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  SkillLibraryImportResultSchema,
  SkillLibraryPreviewSchema,
  type SkillLibraryPreview
} from '../../../../shared/skill-library-contract'
import type { HostedSkillCandidate } from './skill-library-host-discovery'

export type ReviewedHostSkill = { source: HostedSkillCandidate; preview: SkillLibraryPreview }
export const candidateSelectionKey = (candidate: HostedSkillCandidate) =>
  JSON.stringify([candidate.hostId, candidate.id])

export async function reviewSkillBatch(
  target: RuntimeClientTarget,
  candidates: HostedSkillCandidate[]
) {
  const reviews: ReviewedHostSkill[] = []
  // Serial packaging bounds RAM on controllers and hosts shared by multiple containers.
  for (const source of candidates) {
    const preview = SkillLibraryPreviewSchema.parse(
      await callRuntimeRpc(
        target,
        'skills.library.preview',
        { hostId: source.hostId, candidateId: source.id },
        { timeoutMs: 120000 }
      )
    )
    reviews.push({ source, preview })
  }
  return reviews
}

export async function importSkillBatch(
  target: RuntimeClientTarget,
  reviews: ReviewedHostSkill[],
  addVersion: boolean
) {
  const results: { key: string; name: string; status: string; message?: string }[] = []
  const hosts = [...new Set(reviews.map((row) => row.source.hostId))]
  for (const hostId of hosts) {
    const rows = reviews.filter((row) => row.source.hostId === hostId)
    try {
      const response = SkillLibraryImportResultSchema.parse(
        await callRuntimeRpc(
          target,
          'skills.library.import',
          {
            hostId,
            candidateIds: rows.map((row) => row.source.id),
            reviewed: true,
            addVersion,
            expectedDigests: rows.map((row) => ({
              candidateId: row.source.id,
              packageDigest: row.preview.packageDigest
            }))
          },
          { timeoutMs: 600000 }
        )
      )
      for (const row of rows) {
        const result = response.results.find((item) => item.candidateId === row.source.id)
        results.push({
          key: candidateSelectionKey(row.source),
          name: row.source.name,
          status: result?.status ?? 'failed',
          message:
            result?.message ??
            (!result ? 'Missing import result; refresh before retrying.' : undefined)
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Host import failed'
      const unconfirmed = /timed out|disconnect|closed|connection|network/i.test(message)
      results.push(
        ...rows.map((row) => ({
          key: candidateSelectionKey(row.source),
          name: row.source.name,
          status: unconfirmed ? 'unconfirmed' : 'failed',
          message: unconfirmed
            ? `${message}. The server may still be importing; refresh the imported library before retrying.`
            : message
        }))
      )
    }
  }
  return results
}
