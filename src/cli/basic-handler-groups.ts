import type { HandlerGroup } from './handler-group-manifest'

export const BASIC_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'reference',
    keys: ['reference list', 'reference add', 'reference remove', 'reference find'],
    load: async () => (await import('./handlers/reference.js')).REFERENCE_HANDLERS
  },
  {
    name: 'core',
    keys: ['claude-teams', 'open', 'serve', 'status'],
    load: async () => (await import('./handlers/core.js')).CORE_HANDLERS
  }
]
