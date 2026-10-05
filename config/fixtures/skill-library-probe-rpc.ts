import {
  SKILL_LIBRARY_CAPABILITY,
  type SkillLibrarySnapshot,
  type SkillLibraryVersion
} from '../../src/shared/skill-library-contract'
import { LOCAL_SKILL_SHARING_CAPABILITY } from '../../src/shared/local-skill-sharing'

const shares: {
  id: string
  url: string
  name: string
  description: string
  packageId: string
  createdAt: string
  names: string[]
}[] = []

const candidate = {
  id: 'fixture',
  name: 'probe-skill',
  description: 'Disposable renderer fixture',
  providers: ['codex'],
  sourceLabel: 'Fixture home',
  sourceKind: 'home'
}
const version: SkillLibraryVersion = {
  packageId: '00000000-0000-4000-8000-000000000001',
  versionId: '00000000-0000-4000-8000-000000000002',
  name: candidate.name,
  description: candidate.description,
  packageDigest: 'a'.repeat(64),
  archiveSha256: 'b'.repeat(64),
  compressedBytes: 100,
  createdAt: '2026-10-02T10:00:00Z',
  files: [
    { path: 'SKILL.md', size: 20, classification: 'text', executable: false },
    { path: 'run.sh', size: 20, classification: 'text', executable: true }
  ],
  origins: [
    {
      hostId: 'local',
      candidateId: candidate.id,
      sourceLabel: candidate.sourceLabel,
      importedAt: '2026-10-02T10:00:00Z'
    }
  ]
}
const snapshot: SkillLibrarySnapshot = {
  schemaVersion: 1,
  versions: [],
  assignments: [],
  hosts: [
    { id: 'local', label: 'Fixture server', reachable: true },
    { id: 'ssh:fixture', label: 'Fixture distrobox', reachable: true }
  ],
  providers: [{ id: 'codex', displayName: 'Codex' }],
  workspaces: [
    { id: 'fixture-folder', kind: 'folder', label: '/disposable/folder', hostId: 'ssh:fixture' }
  ]
}

export async function callRuntimeRpc(
  _target: unknown,
  method: string,
  params?: {
    destination?: SkillLibrarySnapshot['assignments'][number]['destination']
    providers?: string[]
    reviewed?: boolean
    filePath?: string
  }
) {
  if (method === 'status.get') {
    return { capabilities: [SKILL_LIBRARY_CAPABILITY, LOCAL_SKILL_SHARING_CAPABILITY] }
  }
  if (method === 'skills.library.list') {
    return structuredClone(snapshot)
  }
  if (method === 'skills.library.discover') {
    return { candidates: [candidate] }
  }
  if (method === 'skills.library.listShares') {
    return { supported: true, enabled: true, shares: structuredClone(shares) }
  }
  if (method === 'skills.library.share') {
    shares.push({
      id: 'fixture-share',
      url: 'http://fixture.local/skills/share/fixture',
      name: 'probe-skill',
      description: candidate.description,
      packageId: version.packageId,
      createdAt: version.createdAt,
      names: [version.name]
    })
    return { id: 'fixture-share', url: shares[0].url, packageDigest: version.packageDigest }
  }
  if (method === 'skills.library.preview' || method === 'skills.library.previewVersion') {
    return {
      candidate,
      packageDigest: version.packageDigest,
      files: version.files,
      filePath: params?.filePath ?? 'SKILL.md',
      content: 'Fixture instructions; no content is executed.',
      truncated: false
    }
  }
  if (method === 'skills.library.import' && params?.reviewed) {
    snapshot.versions = [version]
    return { results: [{ candidateId: candidate.id, status: 'imported', version }] }
  }
  if (method === 'skills.library.assign' && params?.destination && params.providers) {
    const assignment: SkillLibrarySnapshot['assignments'][number] = {
      id: '00000000-0000-4000-8000-000000000003',
      packageId: version.packageId,
      versionId: version.versionId,
      destination:
        params.destination.scope === 'global'
          ? { ...params.destination, environmentId: 'skill-library:local-default' }
          : params.destination,
      providers: params.providers,
      executionHostId: 'ssh:fixture',
      desiredState: 'installed',
      status: 'installed',
      checkedAt: '2026-10-02T10:00:00Z',
      message: null
    }
    snapshot.assignments = [assignment]
    return assignment
  }
  throw new Error(`Unexpected fixture RPC: ${method}`)
}
