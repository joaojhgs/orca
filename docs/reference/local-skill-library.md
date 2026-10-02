# Local skill library

## Brief and completion contract

Implement an Orca-owned, server-local library of immutable skill snapshots, with explicit
imports from native and connected SSH execution environments. Users choose skills and
assign a pinned version to a host, a global or registered workspace scope, and coding
runtimes. Provisioning is independent of the launcher and of Multica/Orca Cloud.

## Architecture invariants

- No Cloud account, public links, or Multica dependency for library operations.
- Import only explicitly selected discovery IDs; never arbitrary caller-supplied paths.
- The execution host scans, packages, and mutates its own files. Unreachable hosts must
  never fall back to local execution or be reported as empty/successfully synchronized.
- Reuse the incumbent archive validation, version receipts, modification checks,
  provider placements, locks, and transaction recovery. Never discard local edits.
- Skills are data, not executed during import or provisioning; include scripts/binary
  assets and preserve executable bits. Review must precede import.
- Assignments pin immutable versions. Same-name content collisions remain visible.
- Do not stop/restart agents or replace live relay daemons to roll out this feature.
- Existing sessions may retain their loaded skill list until their next normal start.
- Mutating APIs require an authenticated Orca caller. CLI defaults to its execution
  environment; cross-host operations require an explicit selector.
- Deleting catalog entries must not delete original source folders. Removing an
  assignment must not remove unowned or locally modified installations.

## Durable implementation ledger

OMX's skill package is installed but its CLI/runtime is unavailable in this environment.
This document records the implementation and verification handoff instead. The Codex
goal slot tracks the library objective. The user explicitly resumed implementation
after the interrupted session; only separate, capped validation services are permitted.

| Story | Scope                                                                        | State                                                                                               |
| ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| G001  | Contracts, local storage, validated snapshots, import/version/conflict tests | Implemented and focused checks passed; final review pending                                         |
| G002  | Execution-host discovery/export and safe provisioning/reconciliation         | Implemented; real personal-distrobox e2e and all connected notebook scans passed                    |
| G003  | CLI, browser/desktop library, import review and assignment management        | Implemented; disposable hidden renderer validation passed                                           |
| G004  | Adversarial regression/e2e tests, independent review, safe deployment        | Deployed and live native/SSH checks passed; independent review and broader type-aware gates pending |

## Verification required before completion

Test native and SSH imports, duplicate content, same-name different content, malicious
paths/symlinks, scripts/binary assets, local modifications, failed/disconnected hosts,
retry/restart persistence, pinned updates, protected removal, workspace authority,
runtime coverage, and caller scope. Run targeted type/lint/unit checks and real hidden
browser/desktop workflows. Record independent security and architecture reviews and
check terminal identities before/after deploying the main server only.

No real skill imports or assignments are automatically created for the user's machines.
End-to-end fixtures must use disposable, explicitly created test skills/workspaces.

## Safety checkpoint — 2026-10-02

The native full `pnpm tc:node` check triggered global OOM at 11:07:54 local time.
The kernel killed its `tsc` process (about 3.1 GiB anonymous RSS) inside Orca's
terminal-daemon scope. That scope failed; Orca created a replacement daemon at
11:07:56. The main Orca service was not explicitly restarted.

The user requested stopping the activity that killed the session. No full checks,
builds, tests, deployments, or service restarts may resume in the terminal-daemon
scope. The existing `config/scripts/run-isolated-validation.mjs` now defaults to
a separate systemd service capped at 768 MiB, no swap, and one CPU, with any OOM
confined to that service. Its configurable ceiling is 1 GiB. Large checks must
be split or run elsewhere; never raise this cap to make a check pass.

Implementation has resumed at the user's explicit request. Production is unchanged.
The existing eight snapshot tests passed before the failed full typecheck.

## Read-only deployed-state audit after the interruption

Public `orca-ide status --json` reports runtime 1.4.214 ready. The main service
has zero restarts since its 2026-10-01 start, and the replacement terminal-daemon
scope remains active. No lifecycle or provisioning command was issued.

`orca-ide account list --json` uses `accounts.list` with `refreshUsage:false`,
so this audit did not force provider refreshes. Its cached snapshot contains:

- Codex shared across Orca server, personal distrobox and notebook-personal.
- Personal Claude shared across Orca server, personal distrobox and university;
  notebook-work Claude is independently identified and has working quota data.
- Cursor personal and Antigravity have working quotas; notebook-work Cursor
  reports a stale-token error, not empty/free capacity.
- OpenCode Go, ZAI coding plan, GitHub Copilot and OpenRouter expose quota data.
  Google and Perplexity collectors are not implemented for the detected credential
  types; ordinary Anthropic API credentials require different usage authority.

`orca-ide artifacts list --json` lists three artifacts. Read-only HTTP HEAD
requests to their existing share URLs return 200: one HTML view and two PDFs
with `application/pdf`. No artifact was created, changed, deleted or republished.

These checks do not prove complete browser rendering, SSH port ownership,
caller-scope behavior, or unsupported provider quotas. They do not justify
completing the older automatic goal. Implementation and execution-heavy work
were held until the user's explicit continuation.

## Safe implementation checkpoint — 2026-10-02 12:40 local

- Verified separate validation-service cgroup and actual memory.max, swap.max,
  cpu.max controls. Checks cannot join the terminal-daemon scope.
- Native library tests and existing Skills page: 30 passed together.
- CLI scope/review tests and snapshot review-change guard: 15 passed.
- Runtime restart, folder-host-change, registered offline target, arbitrary
  workspace rejection, and browser review/import tests: 6 passed.
- Focused CLI native TypeScript checker passed. A broader CLI checker exceeded
  768 MiB and was killed in its own service; no cap increase or full retry.
- Standalone execution observer, including native installer dependencies, builds
  to /home/skyron/.cache/orca-skill-library-build. Live relays are untouched.
- Global receipt ownership now uses the persistent profile identity, not Orca's
  ephemeral runtime ID. Folder/worktree assignments fence the saved host.
- Catalog transactions reuse the existing filesystem lock and atomic state writer.
- Browser requests pass the reviewed digest; CLI offers --expected-digest.
- MainPID=1731439, NRestarts=0; terminal daemon remains
  orca-daemon-fb885499-b3e3-4135-96ae-9c12e2b623db.scope.

Still required: focused backend/renderer type checks, changed-code quality and
localization gates, standalone SSH worker integration tests, real native/SSH e2e,
hidden rendered UI validation, independent cleanup/security/architecture reviews,
then safe main/frontend/CLI deployment without replacing SSH relays or terminals.

## Implementation and RAM cleanup checkpoint — 2026-10-02 13:46 local

- Post-cleanup regression run: 117 passed, one incumbent platform-specific test
  skipped, across 13 suites. Includes all supported runtime placements/removal
  at both global and registered-folder scopes, new mobile/browser RPC permissions,
  source discovery completeness, archive quota accounting, and overlapping intent
  protection. Standalone observer was rebuilt before worker tests.
- OpenCode workspace discovery now includes `.opencode/skills`; its custom XDG
  root is accepted by the incumbent recovery journal. Existing providers retain
  their registry order and native roots.
- Host identity is required in stored assignments. Both resolution and catalog
  result commits reject unknown/stale ownership; an old install result cannot
  overwrite a newer removal request or version/provider pin.
- Import approval is keyed to the candidate and digest. Renderer snapshots,
  operation state, and pending selections are fenced to the runtime target,
  including same-ID re-pairs. The host-switch regression passed.
- Focused core/CLI native typechecks passed. Default lint and React Doctor passed
  with zero warnings/errors. Broader type-aware lint and renderer typechecking
  exceeded their isolated cap; they are not claimed as passed.
- English declarations and the generated runtime-required English catalog are
  synchronized, including missing declarations for earlier local customizations.
  Locale catalog/extraction verification remains a final check.
- The actual library component built successfully as a disposable browser fixture.
  Hidden Electron/CDP validation passed: manual review before import, host selection,
  assignment rendering, light desktop/dark mobile screenshots, no horizontal overflow,
  no page errors, and every BrowserWindow remained invisible. No production backend
  or real skill folders were used. Build and render execute in separate services;
  running Vite's dev server and Electron together exceeded the original cap.
- Render evidence: `/home/skyron/.cache/orca-skill-library-renderer.VUuGAt/`.
  Reproduce with `config/scripts/probe-skill-library-renderer.mjs build <disposable-dir>`
  then `render <disposable-dir>`, each through the isolated validation wrapper.
- Production main builds exceeded 768 MiB even without source maps/minification
  and with one Rust worker. `ORCA_BUILD_SOURCEMAPS=0` is an optional main-build
  diagnostic; release/default behavior is unchanged. No main/frontend/CLI/relay
  deployment has occurred. Full packaged RPC and real SSH CLI e2e remain unverified.
- Independent review is unavailable: installed native `code-reviewer`/`architect`
  roles and a role-aware delegation surface are absent. Under the code-review and
  Ultragoal skills this is not approval; no author self-review substitutes for it.
- User authorized non-disruptive RAM/tmpfs cleanup. `/tmp` used 9.8 GiB; a September
  27 game-recorder scratch copy contained about 4.1 GiB of native builds. No open
  file references or modifications within the preceding day were found for that
  build directory. It was moved, recoverably, to
  `/home/skyron/tmpfs-recovery-20261002.NvjiuZ/kstyle-native-builds` on disk.
  Sources/captures and two other scratch workspaces with open shells were untouched.
- `/tmp` fell to 5.8 GiB and available RAM rose from about 4 GiB to 8 GiB. Checked
  active agent/shell PIDs survived. Orca MainPID remains 1731439 with NRestarts=0;
  terminal-daemon scope remains `orca-daemon-fb885499-b3e3-4135-96ae-9c12e2b623db.scope`.
- Raising the build-only isolated cap requires the user's explicit direction.
  Cleanup itself did not change the 768 MiB default or its 1 GiB ceiling.

### Bounded cleanup report

Scope: feature-owned files only. Behavior locked by the suites above. Removed
unknown-owner local defaults, silent recovery/retry failures, duplicate RPC result
schemas, and post-effect review resets. Queue error catches are intentional queue
settlement, not successful-operation claims; remote export cleanup is best-effort
when disconnected. Offline provisioning never executes locally. No dependency or
live-relay replacement was introduced. UI uses the incumbent controls and confirmation
dialog. Mobile UUID metadata is dense but readable; further visual polish is not a
completion claim. Final type-aware/full-build/independent-review gates remain pending.

### Explicit build-limit steering — 2026-10-02

The user approved "Allow a 2 GiB isolated build" after RAM cleanup. The wrapper's
default remains 768 MiB and ordinary checks retain a 1 GiB ceiling. Only an explicit
`--build` invocation permits the approved 2 GiB ceiling, still with no swap,
one CPU/job, its own systemd service and a 30-minute lifetime. Build output remains
staged outside the live `out` tree; this approval does not authorize stopping active
sessions or replacing relays. Locale catalog verification and extraction passed.

## Final source checkpoint — 2026-10-02

- Approved 2 GiB main build passed: 6,603 transformed modules, 1.1 GiB peak,
  zero swap. Output: `/home/skyron/.cache/orca-skill-library-build/main`.
- Full CLI native TypeScript compilation/emission passed into
  `tmp/orca-skill-library-build.TwUDpF/out`; new library command help and five
  existing read-only/dry-run skills commands passed. Packaged dependency-closure
  verification did not pass: the repository's existing `node_modules` symlink
  resolves into a separate deployed directory, outside the checker artifact root.
  Dependencies were not copied or reinstalled to hide that limitation.
- Full renderer build exceeded the approved 2 GiB cap twice, including with a
  smaller 512 MiB JavaScript heap. Both failures were isolated. No further cap
  increase is authorized yet, and no production output was replaced.
- Focused core typechecking passed after required-host schema changes. RPC catalog,
  bundled guide, localization catalog and extraction checks passed.
- Changed-line default, casting, native plugins, React Doctor and design-system
  checks passed with zero new findings after fixing the wrapper's braces and
  moving the assignment dialog scrollbar to its ordinary content container.
  Type-aware quality and full renderer typechecking remain unverified.
- Production remains MainPID 1731439, NRestarts 0. Available memory is about
  8 GiB; `/tmp` remains 5.8 GiB. Independent review remains unavailable.
- Post-cleanup final regression: 117 passed, one incumbent platform-specific
  skip across 13 suites. Hidden desktop/mobile renderer probe rebuilt and passed
  again after the dialog scrollbar fix; windows remained hidden, 261 MiB peak.
- Saving a local implementation checkpoint is not a merge-ready approval or
  deployment. A further 4 GiB isolated frontend attempt was offered to the user;
  it remains unauthorized until their explicit reply.

### Architecture-invariant evidence audit

Source: the brief and invariants at the top of this document, plus the user's
explicit session-safety and build-limit steering. This is implementation/test
evidence, not an independent review verdict. Every row still requires independent
review; real-host and packaged e2e are additional open gates.

| Required invariant                                                      | Implementation evidence                                                                          | Verification evidence                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Local, launcher-independent library; no Cloud or Multica dependency     | `skill-library-service.ts`, `skill-library-placement.ts` reuse native archive/placement services | Service and all-runtime global/workspace placement suites passed                                                         |
| Explicit selection and review; snapshots remain immutable               | Shared schemas, candidate lookup, expected-digest import, version conflict handling              | Unknown path, unreviewed import, changed review digest, same-name version and dedup tests passed                         |
| Execution host owns filesystem work; no offline local fallback          | Runtime destination authority, standalone SSH worker, provider/generation fences                 | Offline host, moved folder, unknown owner, arbitrary host/workspace and upload-disconnect tests passed; real SSH pending |
| Reuse incumbent validation, ownership, locks and recovery               | Store filesystem lock; installer/remover receipt ownership guards and existing recovery          | Original-folder protection, edited placement, serialized import, stale result and existing transaction suites passed     |
| Never execute imported data; preserve scripts/assets/permissions        | Validated archives and manifest-only preview; no script runner                                   | Binary and executable metadata test and standalone worker integration passed                                             |
| Pinned versions and explicit update/removal intent                      | Saved version IDs and compare-before-commit reconciliation                                       | Pin update, offline retry, restart identity and overlapping install/removal tests passed                                 |
| Authenticated transport and explicit CLI cross-host scope               | Existing authenticated RPC registry and mobile allowlist; trusted caller host selector           | Mobile registry/permission and six CLI scope tests passed; packaged RPC pending                                          |
| No automatic user provisioning, source deletion or session interruption | Disposable fixtures; assigned-version deletion guard; bounded staging services                   | Source preservation, protected removal, hidden-window probe, unchanged server/terminal identities                        |

Overall invariant gate: **pending independent review and real packaged/native/SSH e2e**.

## Resumed rollout — explicit 4 GiB build approval

The user directed "bump to 4gb and finish this". Build-only invocations may now
use 4 GiB, with the same separate service, zero swap, one CPU and staged output.
Ordinary validation retains its 768 MiB default and 1 GiB ceiling. Earlier cap
restrictions above record historical checkpoints and are superseded for builds
only. Active agents and live SSH relays remain protected.

## Live rollout checkpoint — 2026-10-02

- Full production renderer build passed at the explicitly approved 4 GiB service
  cap (1 GiB JavaScript heap); renderer boot graph passed, 349 chunks / 4,635.4 KiB.
  Preload and browser projection/verification passed. No dependency install or
  native rebuild was performed.
- Assembled release:
  `/home/skyron/.local/share/orca/deployments/skill-library-66b413ebb5-20261002`.
  Dependencies are hardlinked from the existing verified dependency tree; do not
  install/rebuild into either shared tree. Old chunks and all relay binaries were
  retained. Relay trees compare byte-for-byte equal to the previous deployment.
- Full staged CLI dependency closure passed (630 files), and five read-only/dry-run
  skills commands passed. Preserved mobile bundle integrity passed (122 assets,
  build `fbe64ec591a3a2607a2784f0ed6029cddb946e3257295f1d8b417048b47a7632`).
- Switched source `out` to the release output. The previous complete output is
  recoverable at `tmp/out.pre-skill-library-20261002`. Local Git exclusion covers
  the generated `out` symlink; no generated build files are committed.
- Restarted only `orca-server.service`, through a separate validation service.
  MainPID changed from 1731439 to 2480400, with no automatic restarts. Runtime is
  ready and advertises `skills.local-library.v1`; browser HTTP endpoint returns 200.
- All 29 previous terminal PTY IDs AND incarnation IDs survived and reattached.
  The daemon scope and checked Codex/OpenCode/Claude/shell PIDs remain live. Relay
  handshake still reports `0.1.0+5cdca4731a41`; no relay was replaced or restarted.
- Live disposable e2e passed: native preview/review-digest import, Codex global
  placement, binary asset equality and executable bit preservation; real SSH
  preview/import from personal distrobox deduplicated the same version with two
  host origins. OpenCode and Antigravity SSH provisioning and removal passed.
- The existing distrobox CLI bridge served the new library command without any
  bridge/relay deployment. Default scope selected the personal distrobox and
  omitted the local assignment. Local CLI default scope selected only local.
- Edited disposable native placement was preserved and reported as `conflict` on
  removal. After restoring the test bytes, both native and SSH removals succeeded.
  Snapshot deletion preserved originals. All fixture source files were then
  explicitly removed; library returned to zero versions and zero assignments.
  No actual user skill was imported, assigned, changed or deleted.
- Discovery succeeded on notebook-work (14 candidates), notebook-personal (74),
  and notebook-university (1), using real SSH workers. No live relay updates.
- Previous changed-file cleanup and 117-test / hidden renderer evidence remains
  valid; rollout changes only the build cap and this evidence record. No new
  fallback, dependency or app/runtime behavior was introduced in this final pass.
- Independent `code-reviewer`/`architect` roles and role-aware delegation remain
  unavailable. Under the code-review/Ultragoal contracts this is not approval and
  the goal must not be marked complete. Full renderer typechecking/type-aware
  quality and a real paired-browser interaction test are not claimed as passed.

## Browser navigation follow-up — 2026-10-02

- The paired browser now exposes Settings → Share Skills → Open Skills and
  Show Skills Button. From Skills, choose Local library in the page header.
  These controls do not enable Cloud publishing or require Cloud sign-in.
- New browser profiles show the Skills sidebar shortcut by default. Existing
  explicit hide preferences remain intact; settings can restore the shortcut.
- All 71 targeted settings, browser-preferences, sidebar and Skills page tests
  passed. Five non-type-aware changed-line quality scans reported no new findings.
  Full renderer build, boot graph and browser projection/verification passed.
- Updated only frontend assets and atomically replaced HTML entrypoints, retaining
  old chunks for open clients. No server/daemon/relay restart or dependency rebuild.
  Server MainPID remained 2480400, active, with zero automatic restarts.
- The served HTML, its 43 bootstrap/style/preload references and the lazy Settings
  chunk matched staged build bytes over HTTP. This does not constitute a real
  paired-browser interaction test or independent review approval.

## Library landing and SSH history follow-up — 2026-10-02

- Skills now lands on **Local skill library**, not the legacy installed-skills/sharing
  view. The latter remains available through **Installed skills and sharing**, and
  incoming legacy share links still open their install dialog.
- Discovery defaults to **All connected hosts**. Scans run serially; candidates
  retain their host label and identity. Review, file preview and import use the
  candidate's original host even when multiple hosts return the same candidate ID.
  Failed/offline hosts are reported explicitly without dropping successful results.
- Imports remain explicit and reviewed. Saved versions expose **Assign**, selecting
  the execution host, coding runtimes, and global or registered workspace scope.
  No real user skills or assignments were created by this follow-up.
- Paired-browser session list, title and search requests now forward SSH scope to
  the existing execution-host routes, guarded by `aiVault.execution-hosts.v1`.
  Old servers report unavailable rather than returning native sessions for an SSH
  request. Search consent, browser deletion restrictions and existing local behavior
  remain unchanged. SSH Codex resume preparation never copies transcripts locally.
- The large personal-distrobox history corpus exposed a cancellation crash in its
  separate helper. A late stream error listener prevents the unhandled abort, and
  the helper now returns completed rows within a twenty-second scan budget with an
  explicit partial-history issue. Completed parse-cache entries survive subsequent
  refreshes; this is not a claim that the whole cold corpus has been scanned.
- Main and renderer builds passed in separate build-only services under the user's
  approved 4 GiB cap. Browser projection and boot graph verification passed. One
  announced restart affected only `orca-server.service`; all 29 previous terminal
  PTY/incarnation identities reattached and remained present after the helper update.
  The server stayed active at MainPID 2569861 with zero automatic restarts afterward.
- Updated only the standalone history helper on personal distrobox, notebook-personal
  and notebook-university, with recoverable backups and checksum verification. Their
  `relay.js` bytes were unchanged; no terminal relay, agent or daemon was stopped.
  The old personal helper retired through its existing idle policy before the new
  one started. Future bundled helper distribution was also updated, without changing
  the parent relay bundle or protocol.
- Live skill discovery returned 73 native, 631 personal-distrobox, 74 notebook-personal,
  14 notebook-work and 1 notebook-university candidates. Live SSH history returned
  100 notebook-work sessions initially, 54 notebook-personal sessions and one university
  session, all correctly host-stamped with resolved titles. Personal history completed
  successive partial passes within 21 seconds, increasing from 6 to 23 rows,
  including three scoped to Aurora, and covering Claude, Codex, OpenCode,
  Antigravity and Cursor.
- Notebook-work later became unavailable independently during validation. Its raw
  SSH environment no longer exposed the Node runtime/current helper. It is explicitly
  reported unavailable; no environment reinstall or terminal-relay replacement was
  attempted. It will receive the bundled helper on its next normal supported deployment.
- Targeted UI, RPC, host-scope, SSH routing, scanner and cancellation suites passed;
  the final combined run passed 99 tests, plus two scoped browser-adapter tests.
  Five non-type-aware changed-line quality scans passed over all staged files.
  Full web typechecking exhausted its isolated 1 GiB limit; only that validation
  service was killed. Full typechecking, a real paired-browser interaction and
  independent reviewer approval are still not claimed.

## Imported-only navigation and server-local sharing update

Skills navigation opens **Imported skills**, the reviewed snapshots stored in the active Orca profile. It does not scan homes on navigation. **Import skills** opens discovery on the server and connected SSH hosts; Review reads a bounded preview of the complete package. Import records a content digest and refuses a source that changed after review. Back, Escape and a successful import return to the imported list. Preview errors are visible and retryable.

Imported skills can be reviewed from their immutable archive, assigned, shared or deleted. Import does not install the skill into an agent. Assignment installs a pinned version on the selected execution host, globally or in an exact worktree/folder workspace. It preserves locally modified or unowned files rather than overwriting them. Unassign removes only Orca-owned, unchanged placements.

## Local sharing

Share selects imported version IDs, never arbitrary paths or unimported scan results. One version per skill name can be included in a bundle. Publishing requires explicit file review and the existing human artifact-publishing approval. Agent/CLI publishing additionally requires the separate agent skill-sharing permission; agents must not enable either permission themselves.

When artifacts use the local backend, links use the same artifact viewer origin and port. The unlisted page lists the bundle's files and offers a downloadable archive and verified manifest. Scripts are not executed by publishing or downloading. Executable metadata and checksums are preserved. The local flow does not upload to Orca Cloud or require an Orca account.

Anyone who can reach that server and has the link can download the bundle. A tailnet-only origin is not an Internet-public link. Treat the URL as a credential. Revoking blocks future requests, not copies already downloaded. Sharing pins its own archive: edits to the original, new imports, and removal of an imported version do not change a previously published bundle. Existing Cloud install deep-links remain supported separately; local pages currently provide downloads rather than the Cloud one-click installation dialog.

With local hosting, `orca skills share --skill <imported-name-or-version-id> --bundle-name <name>` shares imported snapshots. Use `orca skills library list --json` for selectors; ambiguous names require exact version IDs. The existing CLI command retains its forwarded-session restriction, so run it on the Orca server. Browser sharing works with server-owned snapshots imported from any supported connected host and requires no relay update.

## What “injection” means

Assignment is filesystem provisioning, not a launch hook or direct prompt injection. Orca creates a canonical `.agents/skills/<name>` placement and any selected provider-specific placements. For example, Claude uses `.claude/skills`; OpenCode uses `~/.config/opencode/skills` globally and `.opencode/skills` in a workspace. Supported global environment overrides and managed Claude profile directories are resolved on the executing host. Provider selection is placement policy, not access control: another runtime that reads the canonical root can still see it.

| Agent launch                         | Can it discover an assignment?                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Orca CLI launch                      | Yes, when its user/configuration and workspace match the assignment.                                 |
| Manually typed into an Orca terminal | Same filesystem rules; no special CLI launch is required.                                            |
| Outside Orca                         | Same rules, provided the runtime supports that directory and uses the same environment.              |
| Multica task                         | Only directories visible to the task's effective environment; not automatic library synchronization. |

Global assignments apply to that host/user/configuration; workspace assignments apply to the selected folder, not automatically to every new worktree. The agent still decides when to use a discovered skill. Running agents may require their own reload or a new session; Orca does not hot-inject instructions or restart them to apply assignments.

The installed Multica source prepares isolated Codex task homes and seeds user skills from the shared `~/.codex/skills`, while Orca's Codex placement uses `.agents/skills`. Therefore isolated Multica Codex tasks are not guaranteed to see a global Orca assignment through that seeding path. Multica's own attached skills can also take precedence by name. Use an assignment to the actual task workspace when native workspace discovery is available, or explicitly import/attach the skill in Multica. Orca's Multica PTY bridge does not synchronize the two libraries.
