# Agent notification stop points

Desktop notification delivery and Electron `serve` delivery share the same final
main-agent eligibility check. A combined pane can display child waiting/working
states without implying that the main agent stopped. Child hook events, roster
drain, replay, cancellation, and session boundaries are not notification triggers.
Agent terminal bells cannot bypass this gate; ordinary shell bells are unchanged.

Codex Stop hooks may arrive after the next autonomous turn has already started.
Before announcing a completion or permission request, the controller runs the
existing standalone execution observer on the owning host. It reads only the
root rollout's bounded tail (overlapping pages, at most 17 MiB) and returns lifecycle/permission facts, not messages
or credentials. Only a currently completed root turn can announce completion.
Permission requests under `approval_policy: never` or an automatic reviewer stay
silent. An actual main-agent `request_user_input` remains eligible in YOLO mode.
Manual approval requests remain eligible when the root is waiting in a running
turn with a non-`never` policy.

The observer uses the hook-reported transcript path for custom runtime homes,
otherwise bounded session-specific discovery. Missing evidence or disconnected
SSH suppresses the claim; it never falls back to the controller's local account.
Pane, launch, provider session and connection ownership are checked again after
the asynchronous observation. This is notification presentation policy, not a
second agent-status store or a change to the combined pane's display fold.

The observer bundle is transported over the existing SSH exec lane. No relay
bundle replacement, new public RPC method, or remote agent restart is required.
