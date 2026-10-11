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
