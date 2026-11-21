import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const SKILL_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'skill-sharing',
    keys: ['skills installed', 'skills share'],
    load: async () => (await import('./skill-sharing.js')).SKILL_SHARING_HANDLERS
  },
  {
    name: 'skill-library',
    keys: [
      'skills library list',
      'skills library discover',
      'skills library preview',
      'skills library import',
      'skills library assign',
      'skills library share',
      'skills library unassign',
      'skills library reconcile',
      'skills library delete'
    ],
    load: async () => (await import('./skill-library.js')).SKILL_LIBRARY_HANDLERS
  },
  {
    name: 'skills',
    keys: ['skills list', 'skills get', 'skills install', 'skills update'],
    load: async () => (await import('./skills.js')).SKILL_HANDLERS
  }
]
