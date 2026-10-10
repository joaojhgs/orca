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
