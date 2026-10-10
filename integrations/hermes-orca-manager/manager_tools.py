"""Narrow model tools over the scoped public CLI, not generic process execution."""
from __future__ import annotations

import json
from threading import Lock
from .manager_state import open_manager_state
from .orca_client import OrcaClient, READ_OPERATIONS, WRITE_OPERATIONS, validated_arguments

TEXT_KEYS = {"run", "task", "dispatch", "workspace-id", "objective", "spec", "title", "deps",
             "parent", "agent", "model", "effort", "retry-of", "body", "message"}
MUTATION_LOCK = Lock()


def client_from_context(ctx):
    return OrcaClient(ctx.get_config("orca_executable", default=""),
                      ctx.get_config("orca_credential_file", default=""))


def schema(name, description, operations):
    keys = set().union(*(required | optional for required, optional in operations.values()))
    properties = {}
    for key in sorted(keys):
        if key in TEXT_KEYS:
            properties[key] = {"type": "string", "minLength": 1, "maxLength": 32768}
        elif key in {"offset", "limit"}:
            properties[key] = {"type": "integer", "minimum": 0, "maximum": 10000 if key == "offset" else 200}
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
            active = state.get("active_decision")
            if not active or not active.get("lease") or not active.get("id"):
                raise ValueError("No adapter-authorized decision is active")
            step = active.get("step", 0)
            validated_arguments(args["operation"], args["arguments"], WRITE_OPERATIONS)
            state.admit_step(active["id"], step, args["operation"], args["arguments"])
            result = client.act(args["operation"], args["arguments"], lease=active["lease"], decision_id=active["id"], step=step)
            state.set("active_decision", {**active, "step": step + 1})
            return result
        finally:
            state.db.close()


def handle(ctx, args, mutate):
    try:
        if not isinstance(args, dict) or set(args) != {"operation", "arguments"}:
            raise ValueError("Only operation and typed arguments are accepted")
        client = client_from_context(ctx)
        if mutate:
            result = act_serially(client, args)
        else:
            result = client.inspect(args["operation"], args["arguments"])
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except ValueError as error:
        return json.dumps({"ok": False, "error": str(error)})
    except Exception:
        return json.dumps({"ok": False, "error": "Orca operation unconfirmed; reconcile rather than launching a replacement"})


def register_manager_tools(ctx):
    available = lambda: bool(ctx.get_config("orca_executable", default="") and ctx.get_config("orca_credential_file", default=""))
    for name, mutate, operations, description in [
        ("orca_manager_inspect", False, READ_OPERATIONS,
         "Inspect approved placements, cached/stale-marked usage/resources, and explicitly addressed owned Runs, Tasks and workers. Contact loss is unverifiable, never process death."),
        ("orca_manager_act", True, WRITE_OPERATIONS,
         "Create an owned Run/Task, start one bounded known-agent worker in an exact approved workspace, guide it or answer a recorded question. No user-owned Run adoption, shell/admin/stop/deploy/merge/security operations. The adapter owns lease and durable request IDs."),
    ]:
        ctx.register_tool(name=name, toolset="orca_manager", schema=schema(name, description, operations),
                          handler=lambda args, mutate=mutate, **kwargs: handle(ctx, args, mutate), check_fn=available)
