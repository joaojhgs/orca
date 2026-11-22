# Normal CLI for interactive supervisors

Coding is an ordinary Orca agent, not the restricted event-reader service identity.
Enable the following plugin settings for an interactive profile:

```yaml
use_standard_cli: true
orca_public_executable: /home/developer/.orca-relay/bin/orca
orca_mailbox_address: hermes:coding
```

The `orca_cli` tool accepts an argv array and invokes that exact executable without
a shell or manager credential. The model can read the version-matched CLI guide,
inspect existing owner-created Runs, Tasks, Dispatches and terminals, guide sessions,
and delegate through the same commands as other agents. Existing projects/sessions
do not need recreation, adoption or a manager-created Run.

Legacy interactive dispatch tools are disabled for these profiles. Old cached tool
calls either translate safe Run/worker reads to normal commands or return an explicit
instruction to use `orca_cli`, not a false manager-ownership/capacity rejection.
Keep the separately scoped service credential for event reading and acknowledgement;
do not use it for ordinary interactive CLI commands or copy owner pairing tokens.

The running plugin must actually register `orca_cli`; a configuration flag cannot
add a tool to an older loaded candidate. `activate-standard-delegation.py`, run by
the operator on the worker, stages only the public CLI modules into a copy of the
active candidates (including profile overrides), preserves each profile’s memory/event
components, enables Work, Coding and Coordinator, and backs up their configuration. Hot-reload those profiles through the native
gateway control socket; do not restart their agents or replace their histories.

On the controlling Orca, enable **Allow this host's orca CLI to control Orca** for
the coding worker. Without this supported per-host opt-in, the SSH bridge filters
inventory to its own host and refuses cross-host delegation. This is independent
of manager service grants. Preserve the other hosts' settings and SSH credentials.

Gateway conversations have no PTY. Their explicitly configured `hermes:<profile>`
mailbox is used only for ordinary send/reply/inbox commands; it is never presented
as a live terminal, borrowed session or worker lifecycle owner. Real terminal/session
identity takes precedence when present.

Normal native coordinator, attempt, retry and target-incarnation checks still apply.
This does not transfer another live coordinator's lifecycle ownership. Guide the
existing root/monitor, preserve project/company-account boundaries, and never claim
accepted input or acknowledged events prove execution/completion/delivery.

For long-running `network forward`, use a managed terminal/user process on the
requesting host; the synchronous `orca_cli` tool has a bounded timeout. See
`docs/agent-network-forwarding.md` for the transport and owner policy.
