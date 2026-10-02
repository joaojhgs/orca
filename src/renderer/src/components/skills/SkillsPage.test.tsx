// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import SkillsPage from './SkillsPage'

const library = vi.hoisted(() => vi.fn((_props: unknown) => null))
const install = vi.hoisted(() => vi.fn((_props: unknown) => null))
vi.mock('./SkillLibraryView', () => ({ SkillLibraryView: library }))
vi.mock('./SkillInstallDialog', () => ({ SkillInstallDialog: install }))
vi.mock('@/hooks/use-active-skill-discovery-runtime-target', () => ({
  useActiveSkillDiscoveryRuntimeTarget: () => null
}))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  useAppStore.setState({ pendingSkillShareId: null, pendingSkillsSharedView: false })
  vi.clearAllMocks()
})
async function renderPage() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<SkillsPage />))
}
describe('Skills navigation', () => {
  it('routes ordinary navigation only to the imported library', async () => {
    await renderPage()
    expect(library).toHaveBeenCalled()
    expect(library.mock.calls.at(-1)?.[0]).toMatchObject({ requestedSharedView: false })
    expect(install.mock.calls.at(-1)?.[0]).toMatchObject({ open: false })
  })
  it('opens locally owned shared links through the library instead of the legacy page', async () => {
    useAppStore.setState({ pendingSkillsSharedView: true })
    await renderPage()
    expect(library.mock.calls.at(-1)?.[0]).toMatchObject({ requestedSharedView: true })
    expect(useAppStore.getState().pendingSkillsSharedView).toBe(false)
  })
  it('retains incoming legacy share-link installation without changing the default list', async () => {
    useAppStore.setState({ pendingSkillShareId: 'legacy-share' })
    await renderPage()
    expect(install.mock.calls.at(-1)?.[0]).toMatchObject({
      open: true,
      initialLink: 'https://app.orca.dev/skills/share/legacy-share'
    })
    expect(library.mock.calls.at(-1)?.[0]).toMatchObject({ requestedSharedView: false })
  })
})
