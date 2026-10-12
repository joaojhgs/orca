import { describe, expect, it } from 'vitest'
import { managerMayObserve } from './manager-event-contract'
const grant = { executionHostIds: ['ssh:approved'], projectIds: ['project'], runIds: [] }
const scope = {
  executionHostId: 'ssh:approved',
  projectId: 'project',
  runId: 'user-owned',
  actor: 'root' as const
}
describe('explicit project-wide manager observation', () => {
  it('can include newly registered projects without broadening execution hosts', () => {
    const all = { ...grant, allRegisteredProjects: true, includeProjectRuns: true }
    expect(managerMayObserve(all, { ...scope, projectId: 'new-project' })).toBe(true)
    expect(
      managerMayObserve(all, {
        ...scope,
        projectId: 'new-project',
        executionHostId: 'ssh:unapproved'
      })
    ).toBe(false)
  })
  it('keeps existing grants owned-Run scoped by default', () =>
    expect(managerMayObserve(grant, scope)).toBe(false))
  it('allows owner-started Runs only with the explicit project observation grant', () =>
    expect(managerMayObserve({ ...grant, includeProjectRuns: true }, scope)).toBe(true))
  it('never broadens host or project boundaries', () => {
    const expanded = { ...grant, includeProjectRuns: true }
    expect(managerMayObserve(expanded, { ...scope, executionHostId: 'ssh:other' })).toBe(false)
    expect(managerMayObserve(expanded, { ...scope, projectId: 'other' })).toBe(false)
    expect(managerMayObserve(expanded, { ...scope, projectId: undefined })).toBe(false)
  })
})
