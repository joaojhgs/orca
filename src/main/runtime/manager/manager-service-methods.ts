/** A service credential never inherits the ordinary CLI's workspace permissions. */
export const MANAGER_SERVICE_METHODS: ReadonlySet<string> = new Set([
  'status.get',
  'manager.eventsRead',
  'manager.eventsWait',
  'manager.eventsCheckpoint',
  'manager.consumerClaim',
  'manager.consumerRenew',
  'manager.consumerRelease',
  'manager.snapshot',
  'manager.runCreate',
  'manager.runShow',
  'manager.runList',
  'manager.taskCreate',
  'manager.taskList',
  'manager.taskShow',
  'manager.workerShow',
  'manager.workerRead'
])
