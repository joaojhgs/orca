import { describe, expect, it } from 'vitest'
import { createUIStore } from './ui-slice-test-harness'

describe('manager page navigation', () => {
  it('redirects legacy manager navigation to terminals without replacing the workspace selection', () => {
    const store = createUIStore()
    store.setState({ activeView: 'tasks', activeWorktreeId: 'repo::main' })
    store.getState().openManagerPage()
    store.getState().openManagerPage()
    expect(store.getState().activeView).toBe('terminal')
    store.getState().closeManagerPage()
    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().activeWorktreeId).toBe('repo::main')
  })
  it('does not replace the current page when closing an already closed manager', () => {
    const store = createUIStore()
    store.setState({ activeView: 'skills' })
    store.getState().closeManagerPage()
    expect(store.getState().activeView).toBe('skills')
  })
})
