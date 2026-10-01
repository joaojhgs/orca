# Local-server quality checkpoint

## Changed-files cleanup plan

Behavior is locked by local artifact lifecycle/isolation/approval tests, account dedup/backoff tests, SSH connection-generation port tests, browser account routing/poll lifecycle tests and system-SSH stdin EOF tests. Keep cleanup inside this task's diff.

1. Remove runtime-to-IPC coupling for MiniMax status; share its existing implementation.
2. Remove swallowed execution-collector failures while retaining explicit per-host unverifiable results.
3. Preserve grounded compatibility boundaries: old clients opt out of SSH port metadata; Cloud remains the default unless local hosting is explicitly configured; an older host rejecting a new account-control method must fail rather than return a stub.
4. Re-run focused tests, bounded typechecks, lint and staged build validation.

## Fallback inventory

- Browser account polling catches transport failures because the owning connection reports them; it never substitutes another server's result and has ownership/unsubscribe regressions.
- Disconnected SSH inventories retain stale records marked unverifiable; never scan localhost for an SSH-only repository. Covered by regressions.
- Standalone Electron networking shim reuses provider parsers but must fail closed when a host proxy cannot be applied, rather than send credentials directly.
- Removed empty top-level collector catch: unexpected cycle failures now reject explicit callers and are logged safely by background callers.

## Architecture invariants

Source: `docs/local-server-completion-plan.md` and the user's goal.

- Execution-host ownership: credentials remain in host-side worker; SSH stdin transports only code and non-secret descriptors. Port results carry connection ownership and are discarded on reconnect. Remote STOP is rejected.
- Account identity: only verified provider/account digests group across hosts; unknown credentials remain host-scoped. Token rotations never become cross-host identity.
- Provider truth: quota comes from provider responses or read-only CLI `/usage`; unsupported quota APIs and throttling remain explicit unavailable/error states.
- Artifacts: separate viewer origin, sandbox without same-origin, capability URLs, profile-scoped SQLite, bounded content/storage and existing human approval.
- Session safety: memory-limited validation services; preserve terminal daemon and existing relay bundle during deployment. All 25 original PTYs remained connected. VNC and Multica retain their configuration but briefly restart because their units depend on Orca.

## Live verification, 2026-10-01

- Hidden paired-browser validation passed all five provider settings sections and local artifact settings/preview. The iframe has `sandbox="allow-scripts"`; JavaScript executes but application localStorage is inaccessible.
- Local artifact CLI publish/update/revoke/delete and persisted-link restart checks passed. The human's HTML test artifact remains published; the separate lifecycle test was removed.
- Fixed system-SSH stream EOF/close ordering and the standalone observer's false proxy detection; live SSH scan produced 40 listeners with remote workspace attribution.
- Verified same-account credential failover regression and provider Retry-After/backoff. Real Claude throttling remains explicit and is not bypassed via another host.
- Focused backend typecheck, main/preload/renderer builds and 37 distinct targeted tests passed. Non-type-aware changed-line quality scans found no new issues. Full type-aware changed-code lint remains unpassed after bounded-heap exhaustion; CI rules were not relaxed.

Independent reviewer/architect evidence remains unavailable: this session has no installed native role directory or tool supporting the required `agent_type`. Do not treat self-audit as independent approval or mark the aggregate goal complete.
