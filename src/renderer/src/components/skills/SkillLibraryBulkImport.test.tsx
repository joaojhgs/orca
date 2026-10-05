// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SkillLibraryBulkImport } from './SkillLibraryBulkImport'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { HostedSkillCandidate } from './skill-library-host-discovery'

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
const candidate = (hostId: string): HostedSkillCandidate => ({
  id: 'same-id',
  hostId,
  hostLabel: hostId,
  name: 'example',
  description: null,
  providers: ['codex'],
  sourceLabel: 'Fixture',
  sourceKind: 'home'
})
async function mount(candidates = [candidate('local'), candidate('ssh:personal')]) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const refresh = vi.fn(async () => {})
  rpc.mockImplementation(async (_target, method, params) => {
    if (method === 'skills.library.preview') {
      return {
        candidate: candidate(params.hostId),
        files: [{ path: 'SKILL.md', size: 5, classification: 'text', executable: false }],
        filePath: 'SKILL.md',
        content: 'Review this skill',
        truncated: false,
        packageDigest: 'a'.repeat(64)
      }
    }
    if (method === 'skills.library.import') {
      return {
        results: [
          {
            candidateId: 'same-id',
            status: params.hostId === 'local' ? 'imported' : 'conflict',
            message: params.hostId === 'local' ? undefined : 'Different snapshot exists'
          }
        ]
      }
    }
    throw new Error('Unexpected method')
  })
  await act(async () =>
    root?.render(
      <TooltipProvider>
        <SkillLibraryBulkImport
          candidates={candidates}
          onPreview={() => {}}
          library={{
            snapshot: null,
            busy: false,
            error: null,
            refresh,
            mutate: vi.fn(),
            run: async (operation) => operation({ kind: 'local' })
          }}
        />
      </TooltipProvider>
    )
  )
  const button = (label: string) => {
    const node = [...document.querySelectorAll('button')].find((row) => row.textContent === label)
    if (!node) {
      throw new Error(`Missing button ${label}`)
    }
    return node
  }
  const click = async (label: string) => {
    await act(async () => fireEvent.click(button(label)))
  }
  return { click, button, refresh }
}
it('uses one review and approval for multiple hosts, retaining only conflicts for retry', async () => {
  const f = await mount()
  await f.click('Select all (up to 50)')
  await f.click('Review and import 2 skills')
  expect(rpc.mock.calls.filter(([, method]) => method === 'skills.library.preview')).toHaveLength(2)
  expect(f.button('Import 2 skills').disabled).toBe(true)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review this skill')
  const approval = document.querySelector('[role="dialog"] button[role="checkbox"]')
  if (!approval) {
    throw new Error('Missing approval')
  }
  await act(async () => fireEvent.click(approval))
  await f.click('Import 2 skills')
  expect(rpc.mock.calls.filter(([, method]) => method === 'skills.library.import')).toHaveLength(2)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Review 1 skill snapshots'
  )
  expect(document.body.textContent).toContain('Different snapshot exists')
  expect(f.button('Import 1 skills').disabled).toBe(true)
  expect(f.refresh).toHaveBeenCalledTimes(1)
})
it('bounds select all at 50 without scanning or importing automatically', async () => {
  const f = await mount(
    Array.from({ length: 70 }, (_, index) => ({ ...candidate('local'), id: String(index) }))
  )
  await f.click('Select all (up to 50)')
  expect(document.querySelectorAll('[role="checkbox"][data-state="checked"]')).toHaveLength(50)
  expect(f.button('Review and import 50 skills').disabled).toBe(false)
  expect(rpc).not.toHaveBeenCalled()
})
