import Database from '../../../sqlite/sync-database'
import { ManagerEventJournal } from '../../manager/manager-event-journal'
import { ManagerPrincipalStore } from '../../manager/manager-principal-store'
import { ManagerRunOwnership } from '../../manager/manager-run-ownership'
import { createManagerConversationTable } from '../../manager/manager-conversation-messages'
import { attachOrchestrationDbMethods } from './attach-orchestration-db-methods'
import { hardenOrchestrationDatabaseFiles } from './database-file-permissions'
import { backfillFederatedStubHomeRuns } from './federation/federated-stub-home-run-backfill'
import type { OrchestrationDbMethods } from './orchestration-db-methods'
import {
  createCoordinatorMailRoutingTrigger,
  createRunCoordinatorAddressTriggers,
  rememberCurrentRunCoordinatorHandles
} from './runs/run-coordinator-mail-routing'
import { createTables } from './schema/create-tables'
import { migrate } from './schema/migrate'
import { backfillStructuredWorkerOrcaSessionIds } from './schema/structured-worker-orca-session-backfill'
import { reconcileSettledWorkerDispatches } from './worker-dispatch/worker-dispatch-settlement'

class OrchestrationDbCore {
  db: Database.Database
  readonly managerEvents: ManagerEventJournal
  readonly managerPrincipals: ManagerPrincipalStore
  readonly managerRuns: ManagerRunOwnership

  // Why: the orchestration DB is created lazily for ALL users, but only the
  // small minority who dispatch work ever have dispatch_contexts rows. The
  // renderer graph publish rebuilds orchestration context on every 16ms tick
  // (buildAgentOrchestrationByPaneKey), issuing 2 queries per terminal. Cache
  // emptiness so the non-orchestration majority short-circuits the whole
  // per-terminal fan-out. Only createDispatchContext flips this false→true.
  hasAnyDispatchContextsCache: boolean | undefined
  localMutationCallerFingerprint: string | undefined

  constructor(dbPath: (string & {}) | ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    createTables.call(this as unknown as OrchestrationDb)
    migrate.call(this as unknown as OrchestrationDb)
    this.managerEvents = new ManagerEventJournal(this.db)
    this.managerPrincipals = new ManagerPrincipalStore(this.db)
    this.managerRuns = new ManagerRunOwnership(this.db)
    createManagerConversationTable(this.db)
    createRunCoordinatorAddressTriggers(this.db)
    backfillFederatedStubHomeRuns(this.db)
    backfillStructuredWorkerOrcaSessionIds(this.db)
    reconcileSettledWorkerDispatches(this.db)
    createCoordinatorMailRoutingTrigger.call(this as unknown as OrchestrationDb)
    rememberCurrentRunCoordinatorHandles.call(this as unknown as OrchestrationDb)
    hardenOrchestrationDatabaseFiles(dbPath)
  }

  close(): void {
    this.db.close()
  }
}

export type OrchestrationDb = OrchestrationDbCore & OrchestrationDbMethods

attachOrchestrationDbMethods(OrchestrationDbCore)

// Why: attach adds methods on the prototype; oxlint forbids class/interface merging, so the construct type is asserted.
export const OrchestrationDb = OrchestrationDbCore as new (
  dbPath: (string & {}) | ':memory:'
) => OrchestrationDb
