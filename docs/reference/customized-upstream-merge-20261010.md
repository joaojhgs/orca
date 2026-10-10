# Customized fork: upstream merge, 2026-10-10

This merge brings upstream `stablyai/orca` main through
`5c7c4930421aca419feb290c36905c19cdb10e2a` into the fork's main branch.
The previous fork tip was `bf3288655171ff8ef9e2931b66a85220a0a7eb16`.
Both histories are retained: 650 upstream-only commits and 75 fork-only commits.

## Transport boundary

Ordinary SSH targets continue using this fork's customized relay, including targets
without active terminals. Connecting a target must not automatically provision or
migrate it to an upstream managed Orca server. Targets explicitly provisioned or
migrated as managed hosts retain upstream's managed-host lifecycle.

The policy is in `src/main/ssh/ssh-host-managed-policy.ts` and the connection entry
point is `src/main/ipc/ssh-host-server-connect.ts`. Managed deployments, migrations,
updates and rollback remain available for a deliberate future migration.

Legacy direct-relay hosts retain workspace-scoped remote CLI coordination unless
explicitly disabled. Managed hosts require opt-in. Remote CLI access does not grant
host, account, settings or skill-library administration privileges.

## Preserved custom functionality

- Electron serving mode and root-agent stop-point notification filtering.
- Server-local artifact publishing, including Markdown, HTML and PDF.
- Imported skill library, host scanning, bulk import/assignment and local sharing.
- Execution-host usage discovery, account de-duplication and provider drilldowns.
- Approved cross-host VNC and ADB discovery, streaming and agent control.
- Remote terminal resource breakdown, port discovery and workspace cleanup.
- SSH transcript/history access, browser clipboard handling and Multica integration.

Upstream implementations supersede overlapping fixes where compatible, including
execution-host routing, terminal lifecycle ownership, account usage subscriptions,
IME handling and native-chat selection protection. Custom RPC methods have explicit
permissions and are included in the generated contract/catalogue.

## Validation and deployment boundary

Validation runs in an isolated worktree, with single-worker unit tests and bounded
typecheck services. No production relay bundle or database is modified, no running
Orca instance is restarted, and no host is migrated as part of this merge.

Completed checks: backend, browser and CLI typechecks; 638 status-bar/native-chat
and relay-policy regression tests; 33 relay recovery and standalone skill-worker
tests; 300 skill UI, caller-scope and browser usage tests; affected-file lint;
generated RPC and skill-guide checks; process-host
import checks; and relay/observer bundle builds. The full upstream test suite and
live-host deployment smoke tests are not part of this source-only integration.

Source integration is not a deployment. Deployment must separately build the new
runtime, preserve existing remote PTYs, validate mixed-version relay capabilities
and verify artifact/preview/usage flows against the deployed server.

## Manager integration checkpoint (source only)

Added a durable scoped event journal, revocable manager service credentials,
fenced consumer leases and explicit service-owned Runs. Inventory and worker
observation reuse existing Tasks, Dispatches, output cursors and host liveness;
the manager cannot borrow a user's coordinator. Runtime admission limits service
credentials to an explicit method list and refuses owner/pairing fallback.

Human notification scope rules are persisted independently of manager delivery.
These foundations are not a completed manager deployment: dispatch, decisions,
the persistent adapter, policy UI and semantic memory still need integration.

The latest foundation regression batch passed 161 tests in 18 files. Separate
backend/CLI typechecks and the changed-code quality gate passed. Hermes on the
private worker authenticated with its own selected default-provider credential;
native model and cross-process memory smoke tests passed. Hindsight is installed
but its backend is not yet configured. No production Orca restart was performed.

### Subsequent implementation checkpoint — 2026-10-10 20:26 UTC

Added narrow worker start, guidance/question tools, canonical dispatch scope and
atomic durable orchestration wakes. Scoped placements, cached account usage and
resource projections reuse current collectors without exposing authentication
metadata. Real worker placement verifies that revocation does not stop a worker.

The standalone Hermes plugin now has a fenced durable adapter and typed model
tools, native-tool-loop decisions, persisted replay receipts, finite retries and
gap reconciliation. It has not been granted service authority or launched as a
manager. Notification/chat UI, OS isolation and deployed multihost acceptance
remain incomplete; this checkpoint must not be represented as ready supervision.

Worker local Hindsight is configured and active: separate pinned API environment,
peer-authenticated Unix-socket PostgreSQL, authenticated loopback memory API and
a serial Hermes-owned LLM route. Retain/semantic recall/reflect, native Hermes
memory-tool use, fresh-process recall and local PostgreSQL restore all passed.
The private database backup remains; only its temporary restore clone was removed.
No cloud memory, borrowed interactive OAuth, paid fallback or new external account
was configured. Encrypted/off-host and full-profile recovery remain unverified.

Latest targeted Orca batch: 48 tests in 7 files. Standalone plugin: 22 unit tests.
Changed-code gate: no new findings across 40 TypeScript files. Production backend
and full CLI typechecks passed, but an all-files backend check including tests
exceeded 4 GiB and is not claimed green. Neither Orca instance was restarted.

### Notification and sandbox checkpoint — 2026-10-10 21:12 UTC

Added actual server-owned revision-fenced notification policy persistence and
scope/actor/destination/device settings. Hidden rendered Electron E2E verifies
human mute and manager supervision remain independent after refresh. Durable
worker-mail/contact wakes use the existing journal; manager mutes apply at read/
wait consumption and never erase history or infer worker death from contact loss.
Latest focused batch: 58 tests/9 files, 23 standalone plugin tests, changed-code
gate zero findings/36 TypeScript files. Production backend typecheck passed with
3.2 GiB peak and no swap. Production renderer/backend builds passed before the
latest small policy fix; final production bundles are being rebuilt separately.

Staged private `hermes-manager` identity and immutable native runtime snapshot.
Native boot plus production-unit-derived negative filesystem/privilege/network
checks passed. No credential custody moved, manager grant issued, consumer started
or production Orca restarted. Private memory role, loopback restrictions, narrow
IPC, manager chat/human gates and deployed multi-host acceptance are still pending.
Native tool mutations now serialize durable step admission under concurrent calls.

Final production main/preload/renderer and projected browser builds passed.
The mobile bundle passed packaged and reproducibility verifiers after its separate
frozen install and generated-asset build (128 assets, 8,075,866 bytes). No production
deployment/restart yet. Manager-only loopback restrictions are now staged/enabled
on the worker; repeated sandbox checks also deny local host SSH. Private profile/
memory custody and service IPC remain pending before a grant or consumer launch.
