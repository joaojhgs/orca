# Native Coding supervision

One Coding gateway watcher covers all registered, granted projects, including
owner-started terminals. Normal terminal/Run actions use `orca_cli`, not a private
manager-owned Run. The service credential is only the scoped event/inventory reader.

Events (including progress and permission waits) enter a durable bounded FIFO.
The read cursor advances only after a batch is persisted; the acknowledged cursor
advances after triage. A full queue applies backpressure without skipping events.
Queued metadata reviews coalesce by session; journal pages pack up to 40 events.
The already-admitted pending batch is never rewritten by either optimization.
An optional quota collector failure cannot stop the event reader or session checks.

Every two minutes the watcher samples metadata. Active sessions receive a review
at most every 15 minutes even without turn-end events; this is not a notification
per heartbeat. An initially observed idle agent is also reconciled once; an idle
label is neither proof of completion nor permission to resume owner-paused work.
Significant evidenced milestones and genuinely necessary owner decisions are sent
through the existing owner destination. Ongoing work gets a consolidated progress
check every three hours (`native_progress_digest_seconds`), including waiting or
blocked sessions. The model checks the actual last-delivered update in its ledger;
a sampler timestamp is never a delivery receipt. Routine activity stays `NO_REPLY`; idle
preflight does not call a model or enter the owner's conversational history.

Temporary capacity evidence schedules bounded rechecks with 2–30 minute backoff.
The triaging model must read the current terminal and original objective before
one same-session continuation. Never restart busy, completed, cancelled or
user-paused work, bypass approvals, switch company accounts, or duplicate workers.
Keyword evidence alone never executes a command.

`supervision_policy.py` is the common owner-authored action/reporting contract used
by the event prompt and profile deployment. A blocked event requires live triage,
an authorized corrective/steering action when possible, and verification or a timed
follow-up. Merely forwarding the failure to Telegram is not supervision. Preserve
explicit pauses, security approvals, project/account boundaries and original session
incarnations. Do not blindly send `continue`, retry an uncertain send, or interrupt
healthy work. Only Coding subscribes automatically, avoiding competing supervisors.

An operator-authored `native_policy_message` revision is admitted once to an
existing profile conversation, including isolated-mode profiles, without resetting
it. Routine batches still run only in isolated cron turns. This handles Hermes's
deliberately frozen system-prompt cache: editing SOUL.md alone affects fresh agents,
not an already-running conversation. Policy acknowledgements remain `NO_REPLY`.

The agent can explicitly defer a check independently of future events:

```json
{
  "action": "defer",
  "terminal": "term_original",
  "incarnation_id": "exact-live-id",
  "reason": "transient-provider",
  "retry_after_seconds": 120
}
```

Use `orca_supervision` for this record, then acknowledge the exact event batch.
After verifying recovery, use `clear-followup` with the same terminal/incarnation.
`status` exposes the pending batch, queue, timers and metadata sampling state.
Rechecks remain native isolated cron turns, not another persistent manager agent.

For large read results, `orca_cli` accepts `select` dotted field paths, including
list mapping (`result.workers[].projection`, `result.page`). Selection is rejected
before mutations; it never strips an uncertain mutation receipt. Native results
remain structured, so an inventory containing a failed worker is not itself a
failed CLI call. Use `--limit`/pagination for transport-size limits.

The installed Hermes revision also needs `hermes-tool-success.patch`: its error
classifier searched serialized successful inventory for the words `failed` and
`error`. The patch honors explicit top-level success/failure while retaining real
top-level errors. Apply as an operator only after checking the installed source;
the plugin never edits Hermes core. Fresh native cron workers load this fix;
already-running conversations are not restarted or rebuilt mid-turn.
