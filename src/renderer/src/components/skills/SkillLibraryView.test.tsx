// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmationDialogProvider } from '@/components/confirmation-dialog'
import { SkillLibraryView } from './SkillLibraryView'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  SKILL_LIBRARY_CAPABILITY,
  type SkillLibrarySnapshot,
  type SkillLibraryVersion
} from '../../../../shared/skill-library-contract'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.resetAllMocks()
})

async function fixture() {
  const candidate = {
    id: 'candidate',
    name: 'fixture',
    description: 'Fixture',
    sourceKind: 'home',
    sourceLabel: 'Codex home',
    providers: ['codex']
  }
  const files = [
    { path: 'SKILL.md', size: 10, classification: 'text' as const, executable: false },
    { path: 'run.sh', size: 12, classification: 'text' as const, executable: true }
  ]
  const version: SkillLibraryVersion = {
    packageId: '00000000-0000-4000-8000-000000000001',
    versionId: '00000000-0000-4000-8000-000000000002',
    name: 'fixture',
    description: 'Fixture',
    packageDigest: 'a'.repeat(64),
    archiveSha256: 'b'.repeat(64),
    compressedBytes: 100,
    createdAt: '2026-10-02T10:00:00Z',
    files,
    origins: [
      {
        hostId: 'local',
        candidateId: 'candidate',
        sourceLabel: 'Codex home',
        importedAt: '2026-10-02T10:00:00Z'
      }
    ]
  }
  const snapshot: SkillLibrarySnapshot = {
    schemaVersion: 1,
    versions: [],
    assignments: [],
    hosts: [{ id: 'local', label: 'Orca server', reachable: true }],
    providers: [{ id: 'codex', displayName: 'Codex' }],
    workspaces: []
  }
  let conflict = false
  rpc.mockImplementation(async (_target, method, params) => {
    if (method === 'status.get') {
      return { capabilities: [SKILL_LIBRARY_CAPABILITY] }
    }
    if (method === 'skills.library.list') {
      return structuredClone(snapshot)
    }
    if (method === 'skills.library.discover') {
      return { candidates: [candidate] }
    }
    if (method === 'skills.library.preview') {
      return {
        candidate,
        packageDigest: version.packageDigest,
        files,
        filePath: params.filePath ?? 'SKILL.md',
        content: 'Instructions to review',
        truncated: false
      }
    }
    if (method === 'skills.library.import') {
      if (!conflict) {
        snapshot.versions = [version]
      }
      return {
        results: [
          {
            candidateId: 'candidate',
            status: conflict ? 'conflict' : 'imported',
            ...(conflict
              ? { message: 'Existing name differs; review a new version.' }
              : { version })
          }
        ]
      }
    }
    throw new Error(`Unexpected RPC: ${method}`)
  })
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const renderTarget = async (target: RuntimeClientTarget) => {
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <ConfirmationDialogProvider>
            <SkillLibraryView target={target} onBack={() => {}} onClose={() => {}} />
          </ConfirmationDialogProvider>
        </TooltipProvider>
      )
    )
  }
  await renderTarget({ kind: 'local' })
  const button = (text: string) => {
    const found = [...document.querySelectorAll('button')].find((node) => node.textContent === text)
    if (!found) {
      throw new Error(`Missing button: ${text}`)
    }
    return found
  }
  const click = async (text: string) => {
    await act(async () => fireEvent.click(button(text)))
  }
  return {
    click,
    button,
    renderTarget,
    setConflict: () => {
      conflict = true
    }
  }
}

describe('browser local skill library', () => {
  it('drops the previous host inventory and review while a new host is loading', async () => {
    const f = await fixture()
    await f.click('Scan host')
    await f.click('Review import')
    expect(document.body.textContent).toContain('Instructions to review')
    const original = rpc.getMockImplementation()
    rpc.mockImplementation((target, method, params) => {
      if (target.kind === 'environment' && method === 'skills.library.list') {
        return new Promise(() => {})
      }
      return original?.(target, method, params)
    })
    await f.renderTarget({ kind: 'environment', environmentId: 'other-host' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Saved versions')
    expect(document.body.textContent).not.toContain('Instructions to review')
    expect(document.body.textContent).toContain('Loading library')
    expect(rpc.mock.calls.some(([, method]) => method === 'skills.library.import')).toBe(false)
  })
  it('requires review approval, pins the reviewed digest, and shows imported files', async () => {
    const f = await fixture()
    expect(rpc.mock.calls.some(([, method]) => method === 'skills.library.import')).toBe(false)
    await f.click('Scan host')
    await f.click('Review import')
    expect(f.button('Import into local library').disabled).toBe(true)
    expect(document.body.textContent).toContain('Instructions to review')
    const approval = [...document.querySelectorAll('button[role="checkbox"]')][0]
    if (!approval) {
      throw new Error('Missing review acknowledgement')
    }
    await act(async () => fireEvent.click(approval))
    await f.click('Import into local library')
    expect(
      rpc.mock.calls.find(([, method]) => method === 'skills.library.import')?.[2]
    ).toMatchObject({
      reviewed: true,
      expectedDigests: [{ candidateId: 'candidate', packageDigest: 'a'.repeat(64) }]
    })
    expect(document.body.textContent).toContain('Saved versions (1)')
    expect(document.body.textContent).toContain('2 files')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps collision results visible instead of treating them as success', async () => {
    const f = await fixture()
    f.setConflict()
    await f.click('Scan host')
    await f.click('Review import')
    const approval = document.querySelector('button[role="checkbox"]')
    if (!approval) {
      throw new Error('Missing review acknowledgement')
    }
    await act(async () => fireEvent.click(approval))
    await f.click('Import into local library')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Existing name differs'
    )
    expect(document.body.textContent).toContain('Saved versions (0)')
  })
})
