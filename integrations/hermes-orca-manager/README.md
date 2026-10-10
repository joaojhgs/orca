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
Completed decisions survive acknowledgement failure without another model call;
mutations have persisted step identities and server-side idempotence. Changed
actions on restart require review. Retries are bounded, and revocation stops only
the manager's own decision process, not workers.

The `orca_manager_inspect` and `orca_manager_act` tools use typed public CLI
commands. The model cannot supply tokens, leases, executable paths or raw shell
commands, and cannot adopt user-owned Runs or invoke stop/merge/deploy/admin APIs.
Queue objectives with `hermes orca-manager objective --request-id <id>
--workspace-id <exact-id> --objective <text>`; the adapter first forwards them to
idempotently created Orca-owned Runs. Its terminal is not yet a chat interface.

The Linux worker memory deployment uses separate pinned Hindsight API and Hermes
environments, a private PostgreSQL Unix socket and authenticated loopback API.
`memory-test` verifies retain/semantic recall/reflect and anonymous-access refusal.
The native provider is activated separately with `memory.provider: hindsight`.
Service templates are specific to the current coding worker and need operator
review before reuse on another machine.

This is not a completed manager deployment. Source-level tests pass, and local
Hindsight retain/recall/reflect passed on the worker, but the manager still needs
live server deployment, OS-level isolation, conversation/UI integration and
multihost restart/revocation validation. No paid API fallback, cloud memory,
third-party account connection or meeting recording is enabled by this plugin.

`stage-worker-isolation.sh` stages a separate `hermes-manager` identity and a
root-owned runtime snapshot without moving OAuth, issuing a grant or starting a
manager. `hermes-orca-manager.service` exposes only synthetic Hermes paths inside
its mount sandbox; the developer's real home and runtime sockets stay hidden.
Only private state and PM lock/lease files are writable. The worker-specific
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
dedicated memory database role and service-only IPC remain required before
the staged manager is granted authority.

Native parallel mutation tool calls are serialized before durable step admission;
read tools remain independent. A concurrent-call regression verifies distinct
ordered steps rather than spurious input-mismatch failures.
