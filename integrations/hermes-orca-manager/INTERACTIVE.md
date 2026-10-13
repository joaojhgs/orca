# Native Hermes sessions

Orca hosts the ordinary Hermes TUI (`hermes --tui`). There is no separate manager
page and no fixed console required to use Hermes. Native profiles and sessions
remain Hermes's own features, rather than a second Orca implementation.

The original worker installation can be migrated explicitly using
`migrate-interactive-profile.py --apply --candidate <staged-candidate>` as root.
It refuses an existing destination or developer login, archives the original
profile and launch configuration under a root-only `/var/backups` directory,
disables only the custom adapter daemon, and moves the profile/session files.
The Hindsight PostgreSQL database and API service are not moved or recreated.
Only its authenticated LLM bridge changes identity and restarts.

One live OAuth store lives at `/home/developer/.hermes/auth.json`. The preserved
`orca-manager` profile uses Hermes's native root credential fallback. Do not
restore an old OAuth snapshot or copy refresh grants into additional profiles.
Rollback must move the **current** credential back with its custody, not reactivate
the archived credential. Archive copies are offline recovery material only.

The operator migration also rematerializes root-owned files in the developer's
package cache without modifying shared payload inodes. Future payload staging
detaches hardlinks before applying root ownership. Plugin dependencies are
admitted through native Hermes PM; do not disable its lock/currency checks.

`hermes --tui` starts a normal session; `hermes -p orca-manager --tui` selects the
preserved history/profile. Additional profiles can use native `hermes profile
create <name> --clone --no-skills`, followed by `hermes -p <name> --tui`. Profile
configuration, identities and memory-bank choices remain user-editable. Cloned
Hindsight settings retain the same bank until explicitly changed.

The plugin's opt-in `orca_events_read` and `orca_events_wait` tools work in ordinary
sessions, without an adapter decision or consumer lease. Reads remain limited by
the scoped service credential; they cannot acknowledge events, claim workers,
stop sessions or acquire owner/admin access. These tools are observation surfaces,
not a claim that a dormant terminal automatically wakes itself. Automatic event
consumption is separate and optional; `orca-manager run` remains an explicit
native CLI command, not a required interface for normal Hermes use.

The previous adapter-only mutation tools are advertised only inside a matching
adapter invocation. Moving to interactive Hermes does not widen the Orca grant,
enroll the worker in the tailnet or grant it direct access to desktop host SSH.
Hermes's desktop Bot Mode and messaging gateways still require their own native
setup; the Orca terminal is not a substitute for Hermes's desktop bot roster.

# Existing-session supervision

On servers advertising `manager.project-sessions.v1`, the native profile tools
support `session-list`, incarnation-fenced `session-read`, and durable
`session-guide`. These cover registered sessions started by the owner or other
agents without adopting a Run/Task/Dispatch. Grants must explicitly include
`session:read`/`session:guide`; project-wide observation still pins approved hosts.
Live relay PTYs remain addressable without a renderer pane binding, including on
headless controllers. Guidance still rechecks the exact incarnation, contact,
project/host grant and running-agent identity before writing; a missing pane is
not permission to spawn or adopt a replacement.

Enable `enable_interactive_tools` in the profile's plugin settings. Company
projects must be listed in `work_project_ids`: raw company output stays with
company Claude, and guidance must target notebook Work Claude. Guidance preserves
ownership, queues without interrupts, refuses shells and uses the same request ID
for exact retries. Contact loss remains unverifiable; it never authorizes a new
writer. The native gateway can reload the plugin without restarting agents; the
tool-registry generation refreshes cached model tools on the next normal turn.

## Quiet isolated supervision

Opt in with `native_isolated_events: true`. The reader keeps durable pending batches,
but does not inject event, startup or policy turns into the human Telegram chat.
Run `hermes -p coding orca-manager supervision-prompt` as the script of a native
agent cron job. When idle it returns `{"wakeAgent": false}`: no model or delivery.
Set `attach_to_session: false`, `cron.mirror_delivery: false`, and an explicit
`telegram:<chat>:<topic>` delivery target, not `bot-chat` or an origin route.
Allow the existing `orca_events`/`orca_dispatch` tools and disable unrelated MCPs.
The ordinary profile's SOUL and memory remain the supervision policy/continuity.

Triage acknowledges the exact batch using `orca_supervision`. Interrupted batches
remain pending and are retried at most every fifteen minutes; preserve stable
action request IDs and reconcile receipts before repeating any side effect.
Large event pages advance only past the forty events actually presented, so
omitted events are reread rather than silently acknowledged. Brief contact flaps
are ignored; the existing sampler detects sustained loss after five minutes,
and contact loss never proves process exit. Quota crossings and overdue active-work
digest checks still use the same sampler and grants.

`supervision-review --request-id <stable-id>` queues an explicit operator-requested
inventory/result review without inventing a completion event or new coding objective.
It preserves existing pending batches and deduplicates the most recent request.

Set `display.memory_notifications: off` to silence memory/skill-review summaries
without disabling learning. Telegram platform display overrides can hide interim
status/diagnostics while retaining normal answers, meaningful results and blockers.
No gateway, Orca, relay or terminal restart is required: use native plugin reload.
