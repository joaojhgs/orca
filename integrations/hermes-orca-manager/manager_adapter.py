"""One fenced event consumer; model calls occur only for pending durable decisions."""
from __future__ import annotations

import hashlib
import json
import uuid
import fcntl

from .decision_runner import run_native_decision
from .manager_state import open_manager_state
from .manager_tools import client_from_context
from .orca_client import CONTROL_OPERATIONS


def decision_identifier(payload):
    return "decision:" + hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def requires_model(payload):
    return bool(payload["objectives"] or payload["gap"] or payload["snapshot"] or
                any(event.get("scope", {}).get("actor") != "manager" for event in payload["events"]))


def snapshot_pages(client):
    items = []
    offset = 0
    for _ in range(20):
        page = client.call("snapshot", {"offset": offset, "limit": 100}, CONTROL_OPERATIONS)
        items.append(page)
        if page.get("nextOffset") is None:
            return items
        offset = page["nextOffset"]
    raise RuntimeError("Snapshot exceeds reconciliation budget; operator review required")


def forward_objectives(client, lease, objectives):
    forwarded = []
    for objective in objectives:
        response = client.act("run-create", {"workspace-id": objective["workspaceId"], "objective": objective["objective"]},
                              lease=lease, decision_id="operator-objective:" + objective["id"], step=0)
        if not isinstance(response.get("run", {}).get("id"), str):
            raise RuntimeError("Objective Run acceptance was not confirmed")
        forwarded.append({**objective, "runId": response["run"]["id"]})
    return forwarded


def process_page(ctx, client, state, lease, page, *, native_decision=run_native_decision):
    cursor = page["cursor"]
    pending = state.get("pending_decision")
    if pending:
        # Replay the persisted input, not newly arrived events or a regenerated timestamp.
        decision_id, payload = pending["id"], pending["payload"]
    else:
        payload = {"cursor": cursor, "events": page.get("events", []),
                   "gap": page.get("gap"), "objectives": forward_objectives(client, lease, state.pending_objectives()),
                   "snapshot": snapshot_pages(client) if page.get("gap") else []}
        decision_id = decision_identifier(payload)
        if requires_model(payload):
            state.set("pending_decision", {"id": decision_id, "payload": payload})
    if requires_model(payload):
        receipt = state.begin_decision(decision_id, payload)
        if not receipt["completed"]:
            attempts = state.get("attempt:" + decision_id, 0)
            if attempts >= 3:
                raise RuntimeError("Decision retry budget exhausted; operator review is required")
            state.set("attempt:" + decision_id, attempts + 1)
            result, session_id = native_decision(ctx, client, state, lease, decision_id, payload)
            state.complete_decision(decision_id, result, session_id)
            state.set("manager_session", session_id)
            print(result.get("text", "Decision completed"), flush=True)
        state.mark_objectives_delivered([objective["id"] for objective in payload["objectives"]], decision_id)
        # Commit local receipt before acknowledging server events; crashes replay without a model call.
        client.call("checkpoint", {"lease": lease, "cursor": payload["cursor"]}, CONTROL_OPERATIONS)
        state.set("cursor", payload["cursor"])
        state.set("pending_decision", None)
        return
    if state.get("cursor") != cursor:
        client.call("checkpoint", {"lease": lease, "cursor": cursor}, CONTROL_OPERATIONS)
        state.set("cursor", cursor)


def run_adapter(ctx):
    from plugins.plugin_storage import plugin_data_dir
    # A second local process must not claim a generation or clear the first one's tool context.
    with (plugin_data_dir("orca-manager") / "consumer.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run_locked_adapter(ctx)


def run_locked_adapter(ctx):
    client = client_from_context(ctx)
    state = open_manager_state()
    lease = None
    consumer_id = "hermes:" + uuid.uuid4().hex
    try:
        lease = client.call("claim", {"consumer": consumer_id, "duration-ms": 60_000}, CONTROL_OPERATIONS)["lease"]
        initial = client.call("read", {"limit": 100}, CONTROL_OPERATIONS)
        if state.get("cursor") is None:
            state.set("cursor", initial.get("checkpoint"))
        while True:
            client.call("renew", {"lease": lease, "duration-ms": 60_000}, CONTROL_OPERATIONS)
            cursor = state.get("cursor")
            values = {"cursor": cursor} if cursor else {}
            if state.get("pending_decision") or state.pending_objectives():
                page = client.call("read", {**values, "limit": 100}, CONTROL_OPERATIONS)
            else:
                page = client.call("wait", {**values, "timeout-ms": 25_000}, CONTROL_OPERATIONS)
            process_page(ctx, client, state, lease, page)
    finally:
        state.set("active_decision", None)
        if lease:
            try:
                client.call("release", {"lease": lease}, CONTROL_OPERATIONS)
            except Exception:
                pass
        state.db.close()
