# Hermes–Orca manager integration

Standalone Hermes plugin. It does not patch Hermes core or read any Codex/Hermes
OAuth credential. The local memory LLM bridge calls the documented `ctx.llm`
interface; Hermes remains the only OAuth refresh owner.

The memory bridge is serial, binds only to `127.0.0.1`, requires a separate
private shared-secret file, and bounds inputs and outputs. Hindsight's fixed
memory-function schemas are translated into host-validated JSON; no function
executes in the bridge or Hermes. Shell/admin function names, streaming,
model/provider/account overrides and arbitrary endpoints are refused. Start with
`hermes -p orca-manager orca-manager memory-llm` after enabling the plugin and
configuring its settings. It never starts a listener during plugin discovery.

`hermes orca-manager run` is a single fenced event consumer. It wakes native
Hermes's tool loop for durable Orca events, gaps or queued operator objectives,
not an idle timer. It keeps delivery/decision receipts, not a second task store.
Completed decisions and final reports survive acknowledgement/delivery failure
without another model call; reports are posted idempotently to the same Orca Run
before journal acknowledgement. Mutations have persisted input/result receipts
and server-side idempotence. Replayed receipts are not current worker status. Changed
actions on restart require review. Retries are bounded, and revocation stops only
the manager's own decision process, not workers.

Each service-owned Run has its own native session, rotated after 12 completed
decisions by default (`max_session_decisions`, operator range 1–20). Legacy shared
sessions are not reused; an ambiguous pending legacy decision requires explicit
operator reconciliation. Cross-host dispatch events follow server-provenanced Run
identity rather than the originating workspace. Gap recovery retains complete
scoped snapshot receipts but gives the model a marked sample and requires current
inventory reads; oversized decision evidence fails closed without acknowledging it.

The `orca_manager_inspect` and `orca_manager_act` tools use typed public CLI
commands. The model cannot supply tokens, leases, executable paths or raw shell
commands, and cannot adopt user-owned Runs or invoke stop/merge/deploy/admin APIs.
Every tool invocation must match the adapter's private decision nonce and Run.
Stale native children cannot borrow a new invocation's lease. The model cannot
create/list other Runs, although the operator's objective queue and adapter retain
those narrow CLI operations. Native memory stays shared for sanitized learned rules;
per-Run chat histories and mutation authority are separate.
Lease renewals and journal checkpoints need explicit, matching acknowledgements;
an empty/ambiguous transport result cannot authorize work or discard receipts.
Queue terminal objectives with `hermes orca-manager objective --request-id <id>
--workspace-id <exact-id> --objective <text>`; the adapter first forwards them to
idempotently created Orca-owned Runs. Its terminal is not a chat interface.
The conversation RPC foundation now lets paired browser/mobile clients create
an objective and send human messages to the same authoritative Run. Messages
carry server-written provenance, bounded sequence pagination and atomic wake-up
events. Service-only `conversation-read`/`conversation-post` operations require
explicit ownership and, for writes, the `conversation:write` grant plus a fenced
lease. Manager replies never wake themselves; question answers cannot cross Runs
or be submitted twice. Browser objective/conversation UI is implemented and tested
with a hidden real backend. Native-mobile rendering, native-owned WebView recovery
and checked manager push routes are implemented and tested in source. Live
deployment and actual device delivery remain separate acceptance checks.

Objective completion is distinct from a worker's completion claim. `task-create`
freezes `--requirements` (work role, exact test commands, optional Git branch) in
the canonical Task's mutation transaction and adds them to its launch spec. After
an authenticated successful work report, a new verification Task addresses that
exact Task/Dispatch/report; it must run/check the requested results independently
and send the typed JSON evidence described in its server-generated launch spec.
The manager cannot use the implementation worker as its own verifier.
Ordinary orchestration child-Task creation in a manager-owned Run also freezes
work requirements and requires separate verification. User-owned Runs keep their
original specifications and behavior; they are not adopted into this policy.

`conversation-post --completion-evidence <json>` lists every canonical Task,
current Dispatch and accepted report exactly once. It refuses missing reports,
old attempts, missing/failed tests, wrong/dirty Git evidence, unowned verification,
pending questions or approval gates. Normal prose replies do not certify a result.
The result, evidence receipt and one root-notification intent commit together;
replaying the mutation does not create another result or notification. Completed
objectives cannot add more Tasks until a new human instruction is recorded.
Late notification digests recheck the certificate against current canonical facts.

This is provenance-checked **separate-agent verification**, not a cryptographic
attestation of the filesystem or test runner. The controller never executes a
worker-supplied shell command. Human requirements expressed only as prose still
need Hermes to translate them faithfully into frozen test/Git requirements;
neither idle status nor an LLM's unbound text supplies completion authority.

The Linux worker memory deployment uses separate pinned Hindsight API and Hermes
environments, a private PostgreSQL Unix socket and authenticated loopback API.
`memory-test` verifies retain/semantic recall/reflect and anonymous-access refusal.
The native provider is activated separately with `memory.provider: hindsight`.
Service templates are specific to the current coding worker and need operator
review before reuse on another machine.

Dispatch admission uses the existing deduplicated execution-account collector and
samples only the selected execution host. An exact, reachable account with fresh
non-exhausted quota is required; OpenCode needs an explicit provider/model prefix.
Healthy future `retryAt` means next collector refresh, not exhausted capacity.
Owner-issued grants set account/host concurrency and conservative memory budgets;
the default reserves 2 GiB for build/test work, 512 MiB for edit-only work and
512 MiB of host headroom. Build/test work defaults to one concurrent build per host.
These are admission reservations, not OS-enforced memory limits. Unknown starts,
stops, placement or contact keep their capacity held. Existing user sessions count
toward shared-account concurrency and are never stopped to make capacity.

Capacity refusals persist a bounded, credential-free wait. A 30-second daemon
observation checks only waiting placements, reuses cached usage, and emits one
durable recovery event when eligible. It never launches a worker or calls a model.
Acceptance rechecks the same rules under the fenced transaction and clears the
Task's waits atomically. Revocation, coordinator replacement and an already
dispatched Task retire the wait. Lost accepted responses still replay the original
receipt without a second launch, even if current usage/resources become unavailable.

The private CLI adapter preserves finite `capacity_wait` diagnostics for recognized
worker-start refusals instead of calling every failure an unconfirmed launch. It
never forwards arbitrary transport messages, stderr or error data to the model.
Unknown responses and contact loss remain unconfirmed; a diagnostic is not a launch
receipt, permission override or evidence of worker death. The original Task and
request identity remain available for reconciliation without launching a replacement.

The controller integration and restricted worker manager are deployed. The manager
was launched through its Orca console; two native decisions, an operator reply and
event-driven resumption passed. Hindsight retain/semantic recall/model reflection
also passed in the production sandbox. Full acceptance is not complete: the
two-host work/independent-verification objective is waiting for build capacity
occupied by an existing user session. Actual browser/mobile delivery and multihost
restart/revocation checks still require live validation. No paid API fallback, cloud memory,
third-party account connection or meeting recording is enabled by this plugin.

`stage-worker-isolation.sh` stages a separate `hermes-manager` identity and a
root-owned native payload without issuing a grant or starting a
manager. `hermes-orca-manager.service` exposes only synthetic Hermes paths inside
its mount sandbox; the developer's real home and runtime sockets stay hidden.
Only private state, caches and PM selections are writable; the payload is not. The worker-specific
runtime paths and UID must be revalidated before reuse elsewhere.

`verify-worker-isolation.sh` derives its properties from that production unit
and runs native launcher help plus negative filesystem/privilege/network checks.
These passed on the coding worker, with no model request or service credential.
`stage-manager-network.sh` installs only the staged identity's loopback guard:
the local memory API/bridge and resolver remain allowed; host SSH and other
loopback services are denied. Its own table never flushes the host firewall or
affects other users. The production manager unit requires this guard. It is
enabled on the worker and the boundary check also passed against local SSH.
These checks do not prove an unbreakable sandbox. Private-profile custody,
the dedicated memory database role and service-only IPC are now installed and
tested as described below. The active service grant covers only the approved
execution hosts and canonical project scopes; the owner credential stays on the
controller, and existing user Runs are not adopted.

### Private native runtime and transport

The worker now uses a supported, verified `hermes pm bundle` payload pinned to
`66605471e9f0b0832abbefaf625ce08e948ca540`, including 49 target-compatible extras.
`stage-native-payload.sh` publishes it root-owned; the production service uses its
relocatable launcher without pretending to be Docker/Nix or suppressing checks.
Private plugin dependencies are admitted with documented `pm.sync_venv`, not pip.
`configure-private-profile.py` migrates canonical `plugins.entries.*.settings`
through Hermes's config writer and confirms the values with the native reader.

`migrate-private-memory.sh` moves the single OAuth profile to `hermes-manager`,
clones all memory into a peer-authenticated database owned by separate
`hermes-memory`, and switches only this integration's services. The memory API
gets independent static keys, never OAuth. Developer access to both the new DB
and protected rollback DB is revoked. Recovery artifacts remain root-private;
both the original and refreshed encrypted off-host recovery copies are retained.
API readiness does not prove model-backed reflection: validate it separately
with `verify-private-memory.sh` in the manager's actual OS sandbox.

The controller's credential-free broker publishes fresh, stripped bootstrap
metadata and forwards its existing Unix IPC over a pinned SSH connection to a
separate no-shell worker identity. That identity permits only remote Unix
forwarding: local forwarding, all TCP listeners, shell/PTY, agent, X11 and tunnel
access are denied. OpenSSH's remote-admission gate is paired with `PermitListen
none`; filesystem permissions isolate the Unix listeners from coding users.
The public CLI is bundled without native agent/admin dependencies, and its
private launcher accepts only non-administrative manager commands. It refreshes
metadata per invocation, requires a private service credential and clears ambient
owner/pairing routing. No owner credential is sent to the worker. A working
transport is not a manager grant or completed browser/mobile integration.

Native parallel mutation tool calls are serialized before durable step admission;
read tools remain independent. A concurrent-call regression verifies distinct
ordered steps rather than spurious input-mismatch failures.

`stage-recovery-backup.sh` pauses only this integration's active memory services,
captures the complete private profile and a PostgreSQL dump, and restores those
services even on failure. Encrypt its output off-host; keep the recovery passphrase
off the worker and out of Git. `verify-recovery-archive.sh` checks decrypted backup
components in a private recovery directory, restores into a new disposable database,
checks native session-database integrity, and never activates the recovered login or
overwrites production. The encrypted round-trip restored 15 memory units and five
native sessions on the worker. Recovery copies remain protected until custody
migration and full acceptance succeed; passing the recovery check alone does not
prove a completed manager deployment.

`verify-native-decision-contract.sh` overlays candidate code only in disposable
services derived from the reviewed production unit. It runs the decision/CLI
regressions on the pinned ARM Python and boots native plugin help without a model
request, grant, consumer or installed-plugin replacement. The separate memory HTTP
unit test uses an arbitrary ephemeral port, intentionally blocked by the production
loopback policy; run that test locally and use the authenticated fixed-port memory
verification for the real sandbox. Never relax the firewall to make a test pass.

`stage-manager-update.sh <source-commit> <standalone-cli>` publishes a root-owned,
checksummed candidate under `/opt/hermes-manager/candidates`, including the
per-objective decision module and regression tests. Repeating it verifies the
existing bytes instead of overwriting them. It does not select the active plugin,
replace the active CLI, touch OAuth or issue a grant. Validate the candidate using
the production-unit-derived sandbox before the separately authorized activation.

`stage-manager-console.sh` installs the reviewed production unit and the fixed
`/usr/local/bin/hermes-manager-console` command, without starting or enabling the
manager. The developer's only sudo permission is its argument-free, root-owned
console entry point. It checks the unit digest, loaded identity, absence of drop-ins
and private grant before enabling and starting exactly `hermes-orca-manager.service`. It then
follows only that unit's logs with no pager and a fixed environment. Launch this
command in the worker's registered Orca workspace; it does not expose the private
profile to the terminal. Closing the console does not stop the persistent service.
This operator launch path is not a manager tool and cannot select another command,
service, identity, grant or executable.

Native notification settings now select an explicit paired Orca server and edit
the same server policy as the browser: saved scopes, actor/destination filters,
selected events, silent/digest delivery, independent manager wakes and device mutes.
Reads and writes are fenced to the selected connection generation; conflicting or
unconfirmed saves require a fresh read rather than automatic replay. Unsupported
servers show a refusal, not a local-policy fallback. Saved disconnected scopes and
device overrides remain intact. The global native settings route needs an updated
mobile app; deploying the server alone does not update an installed native shell.
