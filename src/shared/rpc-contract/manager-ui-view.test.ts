import { describe, expect, it } from 'vitest'
import { TopLevelViewSchema, UiUpdate } from './client-ui/client-ui-params'
import { isTopLevelView } from '../ui-chrome/top-level-view'

describe('manager page UI-state compatibility', () => {
  it('preserves the manager page in a paired browser UI update, including sibling fields', () => {
    expect(UiUpdate.parse({ activeView: 'manager', sidebarWidth: 320 })).toEqual({
      activeView: 'manager',
      sidebarWidth: 320
    })
    expect(TopLevelViewSchema.parse('manager')).toBe('manager')
  })

  it('keeps the RPC view enum consistent with the shared persistence guard', () => {
    for (const view of TopLevelViewSchema.in.options) {
      expect(isTopLevelView(TopLevelViewSchema.parse(view))).toBe(true)
    }
    for (const view of ['constructor', '__proto__', 'future-view']) {
      expect(isTopLevelView(view)).toBe(false)
      expect(TopLevelViewSchema.safeParse(view).success).toBe(false)
      expect(UiUpdate.parse({ activeView: view, sidebarWidth: 320 })).toEqual({ sidebarWidth: 320 })
    }
  })
})
