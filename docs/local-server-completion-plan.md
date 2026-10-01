# Local-server completion checkpoint

Requested 2026-10-01. The active Codex goal owns completion. The installed OMX CLI is unavailable; this document is the durable fallback checkpoint.

## Scope and invariants

- Preserve current VNC, Multica, editor, and runtime customizations and active sessions.
- Credentials and OAuth refresh remain on their execution host; return only safe identity and usage metadata.
- Deduplicate only verified matching provider/account identities. Never merge unknown identities.
- Report disconnected remote observations as unavailable/unverifiable, never as a local substitute.
- Provider throttling and absent quota APIs are explicit unknown states, not fabricated remaining capacity.
- Host artifacts locally without Orca Cloud. Preserve existing sharing permissions, bound storage/content, isolate untrusted HTML from authenticated application state, and default to private host access.
- Extend existing RPCs compatibly and retain older-client behavior where required.

## Completion checks

- [x] Browser account settings use real host APIs, including supported credential/status controls.
- [x] Server-local HTML/Markdown artifact create, list, view, update, revoke and delete work through browser and CLI without Cloud authentication.
- [x] SSH execution hosts collect supported provider credentials, safe identity and usage without exporting secrets.
- [x] Codex, Claude, Cursor, Antigravity and OpenCode credential formats installed in personal are validated; provider-specific limitations are explicit.
- [x] Same-account host/SSH identities deduplicate; separate/unknown identities stay distinct; refreshes honor provider backoff.
- [x] SSH-host listening ports and workspace attribution are verified through real remote execution.
- [x] CLI exposes environment/account-aware usage for dispatch.
- [ ] Focused tests, typechecks, bounded quality review and live deployment checks pass.
- [x] Deploy backend/frontend/CLI safely and verify active-session survival.

## Current checkpoint

Baseline commit: `91fcc2a950`. Backend, preload, renderer, projected web client and CLI are deployed. Focused backend, frontend and CLI typechecks pass. The targeted suite passed 36 tests; the additional persisted-artifact restart regression passed (37 distinct targeted tests). Live personal-distrobox CLI usage returns the server's ten account/provider rows. The same Codex account groups host + personal, Claude groups host + personal + university, and Cursor groups personal + university. OpenCode credentials without verified account identity remain separate. Real quotas were obtained for Codex, Claude, Cursor, Antigravity, OpenCode Go, Z.ai and Copilot; Claude currently reports provider throttling and is not retried through another host to bypass it. Google/OpenCode quota support is explicitly unavailable, not a fabricated usage limit.

Hidden-browser checks on an isolated Xvfb display passed: real usage rows in all five provider sections, server-local artifact settings, the published HTML artifact in the paired browser's sandboxed iframe, script execution, and application-storage isolation. A separate Markdown lifecycle test passed publish/update/revoke/delete; its temporary artifact and source were removed. The user-requested `/home/skyron/orca-local-artifact-test.html` remains published. Its link returns HTTP 200 automatically after a server restart without any CLI/list/settings call to start the viewer.

After the final deployments, all 25 original managed PTY IDs remain connected, terminal daemon PID 1368190 and the sampled existing Codex/OpenCode processes survive, and Orca, VNC and `multica-orca-bridge.service` are active. VNC and Multica have service dependencies on Orca and briefly restart with the server; do not claim their PIDs are preserved.

The human completed the one-time publishing approval. No agent executed its proof command. Local hosting is configured in `~/.config/systemd/user/orca-server.service.d/local-artifacts.conf`, with backend `local`, port `6769`, bind host `100.64.0.3` and public origin `http://100.64.0.3:6769`. Prior Cloud-auth configuration is retained recoverably as `cloud-auth.conf.disabled`.

Remaining gates: the full type-aware changed-code lint exhausted the bounded heap and was stopped; other changed-line lint/casting/plugin/React Doctor/design-system checks passed without new findings. The required independent OMX review roles/native agent-type surface are unavailable in this host session, so independent review is not approved and the overall goal remains active. Do not silently treat partial lint or self-review as the full gate.

Two unbounded TypeScript checks caused global OOM at 16:42 and 17:49 São Paulo time. Both ran inside the terminal daemon's `OOMPolicy=stop` scope and caused it to stop. All further validation must use `config/scripts/run-isolated-validation.mjs` (a separate systemd service, 3 GiB memory cap, no swap, bounded Node heap, one check at a time). Do not run unbounded TypeScript checks in Orca terminals.
