import type { HandlerGroup } from './handler-group-manifest'

/** Eager command keys stay separate from the lazily loaded implementation. */
export const MANAGER_HANDLER_GROUP: HandlerGroup = {
  name: 'manager',
  keys: [
    'manager run-create',
    'manager run-list',
    'manager run-show',
    'manager conversation-read',
    'manager conversation-post',
    'manager task-create',
    'manager task-list',
    'manager task-show',
    'manager worker-show',
    'manager worker-read',
    'manager worker-start',
    'manager check',
    'manager ack',
    'manager worker-guide',
    'manager question-answer',
    'manager snapshot',
    'manager session-list',
    'manager session-read',
    'manager session-guide',
    'manager placements',
    'manager usage',
    'manager resources',
    'manager read',
    'manager wait',
    'manager claim',
    'manager renew',
    'manager release',
    'manager checkpoint',
    'manager authorize',
    'manager revoke'
  ],
  load: async () => (await import('./handlers/manager.js')).MANAGER_HANDLERS
}
