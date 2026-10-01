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

## Selected-account footer follow-up, 2026-10-01 20:23

- A regression reproduced a failed selected-host Claude reading hiding a successful canonical reading for the same verified account. The selected request now carries a SHA-256 credential revision; discovery records the matching local revision, while cross-host grouping still uses verified account identity, never the token digest.
- The projection accepts a healthy canonical reading only when its reachable local source matches the selected request. Different/rotated credentials, SSH-only matches, unknown identities, unverifiable observations and provider errors preserve the selected reading. A successful selected reading stays unchanged.
- Cleanup stayed within these ten changed source/test files. No new abstraction, dependency or alternate provider request path was added. The existing same-account collector failover and provider backoff remain intact; this is a presentation fix, not a retry bypass. No runtime UI styling changed.
- Post-cleanup verification: 13 discovery/projection/collector tests passed, including distinct credential revisions deduplicating under one verified account and no token in exported metadata. Earlier verification passed all 44 focused usage tests and all 32 relevant port/Antigravity tests (four stale scanner request assertions were updated to the implemented SSH-inclusive contract).
- Focused native backend typecheck passed; changed-line non-type-aware quality/casting/plugin/React Doctor/design-system checks found zero new issues. Formatting and `git diff --check` passed. The main/standalone-observer staged build passed within its isolated 3 GiB service; the terminal-daemon entry is byte-identical to the deployed one.
- Full type-aware lint is still unpassed: single-thread and bounded Go-heap runs both reached the isolated 3 GiB limit. Only those validation services were killed; no cap or CI rule was weakened. Independent reviewer/architect approval remains unavailable.
- This follow-up is staged, not yet deployed. There was no Orca restart during this audit: main PID 1497918 and terminal-daemon PID 1368190 are unchanged, Orca/VNC/Multica are active, and the user's retained artifact returns HTTP 200. Next deployment must preserve relay files and the daemon, then verify all managed PTYs, selected-source revision binding and the artifact in the live paired browser.

## Footer rollout and live completion audit, 2026-10-01

- Deployed backend/standalone observer from commit `d139dc4f0d`. Current main PID is 1532538, runtime `cbdfa8e5-8655-4e07-a1b1-6c55d0142ed3`. The immediately previous main bundle is recoverable in `/home/skyron/.cache/orca-before-footer-rollout.5OsjfD`; deployment merged main files without removing relay files or old chunks.
- One controlled server restart: all 25 pre-rollout PTY IDs are still present, connected and writable, with zero orphans or truncation. Terminal-daemon PID 1368190 and all five sampled existing agent processes survived. Orca, VNC and Multica services are active.
- Live account RPC confirms the selected Claude request's credential revision matches a reachable local source in its verified canonical host/SSH account. Its provider's real rate limit remains explicit. Codex, Cursor and Antigravity return healthy readings; the personal-distrobox CLI returns all ten account/provider rows, including OpenCode provider-specific readings and Google's explicit unavailable quota API.
- Live SSH-inclusive scan returned 39 remote listeners, six workspace-attributed entries (including IPv4/IPv6 VNC duplicates), Blender and OpenCode, with no unavailable host. Remote execution ownership is preserved.
- The retained artifact returns HTTP 200 automatically after startup. Hidden paired-browser validation passed every provider settings section, local artifact settings, the published preview, script execution and application-storage isolation (`sandbox="allow-scripts"`), with no page errors. The first smoke attempt timed out on the global Settings shortcut; the fixture now clicks the real Settings button (or retains an already-open Settings page) and passed. No runtime UI or shortcut behavior was altered.
- Cleaner follow-up is confined to the smoke fixture: removed the unnecessary global-shortcut dependency, retained all assertions, added no fallback, abstraction or dependency. Syntax and diff checks passed. No additional application restart was needed.
- Functional deployment evidence does not waive final gates. Full type-aware changed-code lint still cannot complete within the required isolated memory limit, and independent native `code-reviewer`/`architect` lane evidence is unavailable. These same conditions remain across consecutive goal checkpoints; there is no independent approval or aggregate completion claim.
