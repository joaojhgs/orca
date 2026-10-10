import { describe, expect, it } from 'vitest'
import { createUIStore } from './ui-slice-test-harness'

describe('manager page navigation', () => {
  it('closes back to the previous page without replacing the workspace selection', () => {
    const store = createUIStore()
    store.setState({ activeView: 'tasks', activeWorktreeId: 'repo::main' })
    store.getState().openManagerPage()
    store.getState().openManagerPage()
    expect(store.getState().activeView).toBe('manager')
    store.getState().closeManagerPage()
    expect(store.getState().activeView).toBe('tasks')
    expect(store.getState().activeWorktreeId).toBe('repo::main')
  })
  it('does not replace the current page when closing an already closed manager', () => {
    const store = createUIStore()
    store.setState({ activeView: 'skills' })
    store.getState().closeManagerPage()
    expect(store.getState().activeView).toBe('skills')
  })
})
