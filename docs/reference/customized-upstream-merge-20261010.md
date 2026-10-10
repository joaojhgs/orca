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

### Private recovery checkpoint — 2026-10-10

Added operator-only full-profile/PostgreSQL backup and restore rehearsal scripts.
Only the integration's own memory services are paused and restored; no user agent
or Orca restart is involved. Encrypted off-host round-trip restored 15 memory units
and five native sessions, with SQLite integrity checked and recovered OAuth never
activated. A fresh disposable database was dropped; production was unchanged.
Recovery credentials/artifacts are private, never repository inputs. Private
profile custody and supported native packaging still precede manager activation.

### Browser manager conversation checkpoint — 2026-10-10 23:12 UTC

The sidebar now opens an owner-routed Manager page over canonical service-owned
Runs. It supports workspace-scoped objectives, paged conversation history,
follow-ups and answers to recorded questions. Revoked managers retain readable
history but cannot receive messages. Consumer connectivity is shown separately
from task progress; accepted submissions are explicitly queued, not started.

Typed shared readers reject absent acknowledgements and inconsistent pagination.
Ambiguous writes persist their exact request receipt in tab-local recovery storage
before sending; retry reuses the same identity after reload. Read-only navigation
remains available while a receipt is unconfirmed. Storage failure prevents writes.
Explicit desktop server selection never falls back to local when its peer is
missing; existing skill discovery retains its legacy single-owner behavior.

Validation: 93 targeted tests in nine files, production renderer typecheck, all
seven changed-source quality scans and a real hidden Electron/backend journey
pass. That journey creates an objective, posts a manager question, answers it,
reloads persisted history and verifies read-only UI after revocation. It caught
and fixed native window-control overlap. Standard shadcn conversation components
reuse Orca Markdown and existing buttons; no styling gate was weakened.

This remains source-only: native mobile manager navigation, automatic per-Run
Hermes reports, live private-grant/event-consumer validation, the remaining human
approval/notification/placement gates and final VPS deployment are not completed.
Hermes and its private memory services remain on the coding worker, not the
controller. No production Orca or user agent was restarted or stopped.

### Native custody and private IPC checkpoint — 2026-10-10

Published the official pinned ARM PM payload with 49 compatible extras under
root ownership; native boot no longer produces the former packaging warning.
Private Hindsight dependencies were admitted through Hermes PM, without core
patches or direct pip/uv environment edits. A malformed seeded wheel cache was
preserved recoverably before regenerating only its cache entries.

Moved the existing profile, rather than duplicating an active OAuth refresh owner,
to nologin `hermes-manager`. Separate nologin `hermes-memory` owns the private DB
and API and receives only static memory keys. All 15 memory units were cloned;
the coding user is refused both DBs and the private login. The original DB and
full profile rollback remain protected. Corrected migration settings against
the actual native plugin reader; retain/semantic recall/reflection now pass in
the production manager sandbox, including anonymous-access refusal.

Private controller-to-worker IPC uses a dedicated no-shell Unix-forward identity,
fresh credential-free runtime metadata and the bundled public CLI. Coding-user
transport access, shell/PTY and TCP forwards are refused. A real invalid-service
CLI call is denied without owner fallback. The broker and SSH process together
used roughly 13–25 MiB on the controller; its main PID and restart count are unchanged.
The broker's own restart test reconnected the private transport, not Orca.

Post-custody encrypted SSD recovery restored all 15 memory units and five native
sessions into disposable/private recovery state without activating recovered
OAuth. Private plugin source is materialized into that archive. Production DB
and user sessions are untouched by the rehearsal. Recovery copies are retained.
27 standalone Python tests, the private broker contract, shell syntax checks
and actual worker boundaries pass. No live manager grant/consumer, manager chat
UI, final Orca deployment or multi-host acceptance is claimed complete.

### Durable manager conversation foundation — 2026-10-10

Paired browser/mobile owner operations can now create an objective in a scoped
manager-owned Run, read its conversation and enqueue human follow-ups. Content
and sequence ordering reuse existing Orca messages; the small provenance table
prevents forged mailbox handles from becoming authenticated human/manager chat.
Creation, message insertion, event wake-up and request receipts commit together.
The service can read only its own conversations and needs a fenced lease plus
explicit `conversation:write` to post. Its replies create no self-wake, and
human question answers cannot cross Runs or be submitted twice. Owner history
remains readable after revocation, but no further messages can be sent.

The typed CLI and native Hermes tools expose bounded sequence pagination and
conversation replies/questions, without granting owner/admin operations. Large
bodies are byte-bounded below the CLI read budget. Browser/mobile owner catalogs
publish safe manager state and owned conversations, never bearer/hash/consumer
credentials. Workspace admission is shared with existing service Run creation;
host ownership and folder-workspace behavior remain canonical.

This is an RPC/CLI foundation, not a rendered or deployed conversation UI. Native
Hermes remains on the coding worker; no manager grant/consumer was activated and
neither Orca was restarted. Fresh controller sampling confirms global paging/IO
pressure with available memory and no Orca cgroup OOM or service restart; it does
not establish one definitive disconnect cause or justify changing limits blindly.

### Native per-Run decision and recovery checkpoint — 2026-10-10

Hermes decisions now route by verified service-owned Run identity, including
workers on another approved host or worktree. Each objective has its own native
session, rotated after 12 completed decisions by default. Shared legacy sessions
are not reused; ambiguous pending decisions require explicit reconciliation.
Complete wake batches retain their original inputs across partial processing.

Final reports publish idempotently into the same Orca conversation before journal
acknowledgement. Missing or mismatched report/checkpoint/lease acknowledgements
fail closed without losing recovery state or repeating completed model work.
Snapshot reconciliation preserves full scoped receipts but marks its bounded
model-context sample; it never silently drops oversized canonical evidence.

Model tools require the matching private invocation nonce and addressed Run.
Stale processes cannot borrow replacement authority or overwrite its context.
Action inputs/results are durable ordered receipts; cached acceptance is not
current worker status. Run creation/listing remain adapter/operator-only, not
model tools. Native memory can still retain sanitized cross-project learning.

Validation: 64 local Python tests; 51 focused decision/CLI tests on pinned ARM
Python in the worker sandbox; real native plugin bootstrap; shell syntax and
whitespace checks. The sandbox's loopback firewall correctly blocks a separate
memory unit test's arbitrary ephemeral port and was not weakened. Production
memory has its own authenticated fixed-port validation.

Candidate code was mounted read-only into disposable checks, not installed over
the live plugin. No manager grant/consumer, production Orca restart, native-mobile
UI or completed multi-host deployment is claimed. Hermes remains on the coding
worker, never the 1 GiB controller. Final deployment and acceptance remain pending.

### Native mobile manager checkpoint — 2026-10-10 23:53 UTC

Added a native Manager route from the selected paired controller's Home menu.
It presents exact SSH/folder workspace choices, service-owned objective history,
recorded questions and human replies. Read-only history survives revocation;
consumer connectivity is distinct from confirmed progress. It never guesses a
workspace or exports pairing/service credentials into conversation data.

Native request recovery stores a validated receipt before dispatch and verifies
write/delete readbacks. Its key hashes both controller and native pairing identity;
concurrent requests cannot replace an unresolved receipt. Transport ambiguity
retains the exact request ID across remounts. Invalid acknowledgements and stale
logical-client generations are refused. Connected-to-connected migration remounts
the presentation while preserving the original controller's durable receipt.

Shared receipt schemas preserve browser behavior. Two pre-existing merged mobile
chat nullability errors were repaired without changing transcript routing.
The native production typecheck and production renderer typecheck pass, as do
88 targeted mobile tests in eight files and 20 shared/browser tests in two files
pass. All changed-source quality scans remain clean.

This is source-only native UI, not a deployed mobile app or live manager. The
page/WebView bridge intentionally refuses its placeholder identity for recovery;
a negotiated native-owned receipt seam, OTA route integration and push deep-links
remain required. Device validation, remaining notification/approval/placement
gates, live service-grant/model/dispatch acceptance and final VPS deployment remain
unfinished. Hermes stays on the coding worker. No production Orca, relay or user
agent was restarted, stopped or replaced, and no manager consumer was started.
