"""Narrow model tools over the scoped public CLI, not generic process execution."""
from __future__ import annotations

import json
import os
from threading import Lock
from .manager_state import open_manager_state
from .orca_client import OrcaClient, READ_OPERATIONS, WRITE_OPERATIONS, validated_arguments
from .orca_failure import OrcaOperationError

TEXT_KEYS = {"run", "task", "dispatch", "workspace-id", "objective", "spec", "title", "deps",
             "parent", "agent", "model", "effort", "retry-of", "body", "message", "kind", "reply-to",
             "requirements", "completion-evidence", "work-class"}
MUTATION_LOCK = Lock()
MODEL_READ_OPERATIONS = {key: value for key, value in READ_OPERATIONS.items() if key != "run-list"}
MODEL_WRITE_OPERATIONS = {key: value for key, value in WRITE_OPERATIONS.items() if key != "run-create"}


def require_active_decision(state, operation, values):
    active = state.get("active_decision")
    invocation = os.environ.get("ORCA_MANAGER_DECISION_INVOCATION")
    if (not active or not active.get("lease") or not active.get("id") or not invocation or
            active.get("invocationId") != invocation or not active.get("runId")):
        raise ValueError("No matching adapter-authorized objective decision is active")
    if operation in {"run-create", "run-list"} or ("run" in values and values["run"] != active["runId"]):
        raise ValueError("This decision may only inspect or mutate its addressed objective")
    return active


def client_from_context(ctx):
    return OrcaClient(ctx.get_config("orca_executable", default=""),
                      ctx.get_config("orca_credential_file", default=""))


def schema(name, description, operations):
    keys = set().union(*(required | optional for required, optional in operations.values()))
    properties = {}
    for key in sorted(keys):
        if key in TEXT_KEYS:
            properties[key] = {"type": "string", "minLength": 1, "maxLength": 32768}
        elif key in {"offset", "limit", "after-sequence"}:
            properties[key] = {"type": "integer", "minimum": 0, "maximum": 10000 if key == "offset" else 200}
            if key == "after-sequence":
                properties[key]["maximum"] = 9007199254740991
        elif key == "cursor":
            properties[key] = {"anyOf": [{"type": "string", "minLength": 1, "maxLength": 2048}, {"type": "integer", "minimum": 0}]}
    return {"name": name, "description": description, "parameters": {
        "type": "object", "additionalProperties": False,
        "properties": {"operation": {"type": "string", "enum": sorted(operations)},
                       "arguments": {"type": "object", "additionalProperties": False, "properties": properties}},
        "required": ["operation", "arguments"],
    }}


def act_serially(client, args):
    # Hermes may issue tool calls concurrently; durable action steps must stay ordered.
    with MUTATION_LOCK:
        state = open_manager_state()
        try:
            active = require_active_decision(state, args["operation"], args["arguments"])
            step = active.get("step", 0)
            validated_arguments(args["operation"], args["arguments"], WRITE_OPERATIONS)
            state.admit_step(active["id"], step, args["operation"], args["arguments"])
            receipt = state.step_result(active["id"], step)
            result = receipt["result"] if receipt else client.act(
                args["operation"], args["arguments"], lease=active["lease"], decision_id=active["id"], step=step)
            if not state.finish_step(active, step, result):
                raise ValueError("Decision invocation was replaced; do not borrow its authority")
            return {"result": result, "replayed": receipt is not None}
        finally:
            state.db.close()


def handle(ctx, args, mutate):
    try:
        if not isinstance(args, dict) or set(args) != {"operation", "arguments"}:
            raise ValueError("Only operation and typed arguments are accepted")
        client = client_from_context(ctx)
        if mutate:
            receipt = act_serially(client, args)
            result = receipt["result"]
        else:
            validated_arguments(args["operation"], args["arguments"], READ_OPERATIONS)
            state = open_manager_state()
            try:
                require_active_decision(state, args["operation"], args["arguments"])
                result = client.inspect(args["operation"], args["arguments"])
            finally:
                state.db.close()
        return json.dumps({"ok": True, "result": result,
                           **({"replayed": receipt["replayed"]} if mutate else {})}, ensure_ascii=False)
    except OrcaOperationError as error:
        return json.dumps({"ok": False, "error": str(error), **error.diagnostic})
    except ValueError as error:
        return json.dumps({"ok": False, "error": str(error)})
    except Exception:
        return json.dumps({"ok": False, "error": "Orca operation unconfirmed; reconcile rather than launching a replacement"})


def register_manager_tools(ctx):
    available = lambda: bool(ctx.get_config("orca_executable", default="") and ctx.get_config("orca_credential_file", default=""))
    for name, mutate, operations, description in [
        ("orca_manager_inspect", False, MODEL_READ_OPERATIONS,
         "Inspect approved placements, cached/stale-marked usage/resources, and explicitly addressed owned Runs, Tasks and workers. Contact loss is unverifiable, never process death."),
        ("orca_manager_act", True, MODEL_WRITE_OPERATIONS,
         "Create a Task with frozen requirements, start a bounded worker in an exact approved workspace, guide/answer it, or post a conversation reply/question. A completion-evidence JSON string covers all Tasks and requires separately dispatched verification for work Tasks; ordinary replies do not complete objectives. Replayed receipts are not current worker status: inspect live state. No Run creation/adoption, shell/admin/stop/deploy/merge/security operations. The adapter owns leases and durable request IDs."),
    ]:
        ctx.register_tool(name=name, toolset="orca_manager", schema=schema(name, description, operations),
                          handler=lambda args, mutate=mutate, **kwargs: handle(ctx, args, mutate), check_fn=available)
