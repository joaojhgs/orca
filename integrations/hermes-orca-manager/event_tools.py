"""Read-only event access for ordinary native Hermes sessions and profiles."""
import json
from .orca_client import OrcaClient, CONTROL_OPERATIONS


def read_events(ctx, args, wait=False):
    try:
        if ctx.get_config("enable_event_tools", default=False) is not True:
            raise ValueError("Event tools are not enabled for this profile")
        allowed = {"cursor", "timeout-ms"} if wait else {"cursor", "limit"}
        if not isinstance(args, dict) or set(args) - allowed:
            raise ValueError("Only a cursor and bounded event options are accepted")
        values = dict(args)
        if 'cursor' in values:
            cursor = values['cursor']
            if (not isinstance(cursor, dict) or set(cursor) != {'journalId', 'sequence'} or
                    not isinstance(cursor['journalId'], str) or not 1 <= len(cursor['journalId']) <= 200 or
                    isinstance(cursor['sequence'], bool) or not isinstance(cursor['sequence'], int) or
                    not 0 <= cursor['sequence'] <= 9007199254740991):
                raise ValueError('Use the exact journal cursor returned by Orca')
        key, default, maximum = ("timeout-ms", 10000, 20000) if wait else ("limit", 50, 200)
        value = values.setdefault(key, default)
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
            raise ValueError("Event option exceeds its budget")
        client = OrcaClient(ctx.get_config("orca_executable", default=""),
                            ctx.get_config("orca_credential_file", default=""))
        result = client.call("wait" if wait else "read", values, CONTROL_OPERATIONS)
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except ValueError as error:
        return json.dumps({"ok": False, "error": str(error)})
    except Exception:
        return json.dumps({"ok": False, "error": "Event transport unavailable; no owner fallback attempted"})


def register_event_tools(ctx):
    def available():
        return (ctx.get_config("enable_event_tools", default=False) is True and
                bool(ctx.get_config("orca_executable", default="") and
                     ctx.get_config("orca_credential_file", default="")))

    for wait, name, key, maximum, description in [
        (False, "orca_events_read", "limit", 200,
         "Read durable scope-filtered Orca events. Preserve the returned cursor; replay gaps require reconciliation. This does not claim, acknowledge or modify another session."),
        (True, "orca_events_wait", "timeout-ms", 20000,
         "Wait for scoped Orca events without model polling. Pass the previous cursor. Empty results are not session death. This does not take a manager lease or modify sessions."),
    ]:
        ctx.register_tool(name=name, toolset="orca_events", schema={
            "name": name, "description": description,
            "parameters": {"type": "object", "additionalProperties": False,
                           "properties": {"cursor": {
                               "type": "object", "additionalProperties": False,
                               "properties": {"journalId": {"type": "string", "minLength": 1, "maxLength": 200},
                                              "sequence": {"type": "integer", "minimum": 0, "maximum": 9007199254740991}},
                               "required": ["journalId", "sequence"]},
                                          key: {"type": "integer", "minimum": 1, "maximum": maximum}}},
        }, handler=lambda args, wait=wait, **kwargs: read_events(ctx, args, wait), check_fn=available)
