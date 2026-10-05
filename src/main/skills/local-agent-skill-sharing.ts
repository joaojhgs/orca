import { basename } from 'node:path'
import type {
  AgentSkillShareRequest,
  AgentSkillShareOperation
} from '../../shared/agent-skill-sharing-contract'
import {
  AgentSkillSharingError,
  AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
  AGENT_SKILL_SELECTOR_NOT_FOUND_CODE
} from '../../shared/agent-skill-sharing-contract'
import type { SkillLibraryService } from './skill-library-service'
import { localSkillShareUrl, publishLibrarySkills } from './local-skill-library-sharing'

export async function publishImportedSkillsFromAgent(
  library: SkillLibraryService,
  request: AgentSkillShareRequest,
  origin: string
): Promise<AgentSkillShareOperation> {
  const catalog = await library.store.snapshot()
  const versions = request.skillSelectors.map((selector) => {
    const exact = catalog.versions.find((row) => row.versionId === selector)
    const matches = exact ? [exact] : catalog.versions.filter((row) => row.name === selector)
    if (matches.length !== 1) {
      throw new AgentSkillSharingError(
        matches.length ? AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE : AGENT_SKILL_SELECTOR_NOT_FOUND_CODE,
        `Imported skill is missing or ambiguous: ${selector}. Import it first or use an exact version ID from skills library list.`
      )
    }
    return matches[0]
  })
  const selected = [...new Map(versions.map((version) => [version.versionId, version])).values()]
  const share = await publishLibrarySkills(library, {
    versionIds: selected.map((version) => version.versionId),
    bundleName: request.bundleName,
    reviewed: true
  })
  return {
    status: 'ok',
    value: {
      version: {
        packageId: share.manifest.packageId,
        versionId: share.manifest.versionId,
        name: share.manifest.bundleName,
        description: share.manifest.description,
        packageDigest: share.manifest.bundleDigest,
        archiveSha256: share.archiveSha256,
        compressedBytes: share.compressedBytes,
        createdAt: share.createdAt,
        releaseNotes: request.releaseNotes,
        manifest: share.manifest
      },
      share: { id: share.id, url: localSkillShareUrl(origin, basename(library.store.root), share) },
      selectedSkills: selected.map((version) => ({
        id: version.versionId,
        name: version.name,
        description: version.description
      }))
    }
  }
}
