"""Route immutable wake evidence to service-owned Runs, never a shared model session."""
from __future__ import annotations

import json
from collections import Counter

MAX_PROMPT_BYTES = 192 * 1024


def read_owned_runs(client):
    rows, offset, seen = [], 0, set()
    for _ in range(10):
        page = client.inspect("run-list", {"offset": offset, "limit": 100})
        if not isinstance(page, dict) or not isinstance(page.get("runs"), list):
            raise RuntimeError("Owned Run inventory was not confirmed")
        for row in page["runs"]:
            run = row.get("run") if isinstance(row, dict) else None
            scope = row.get("scope") if isinstance(row, dict) else None
            if (not isinstance(row, dict) or row.get("ownership") != "service-principal" or not isinstance(run, dict) or
                    not isinstance(run.get("id"), str) or not run["id"] or
                    not isinstance(run.get("objective"), str) or not isinstance(scope, dict) or
                    not isinstance(scope.get("executionHostId"), str) or not scope["executionHostId"] or
                    not isinstance(scope.get("workspaceId"), str) or not scope["workspaceId"] or run["id"] in seen):
                raise RuntimeError("Owned Run inventory needs reconciliation")
            seen.add(run["id"])
            rows.append(row)
        following = page.get("nextOffset")
        if following is None:
            return rows
        if isinstance(following, bool) or not isinstance(following, int) or following <= offset:
            raise RuntimeError("Owned Run pagination did not advance")
        offset = following
    raise RuntimeError("Owned Run reconciliation exceeds its bounded inventory")


def scope_matches(scope, owner):
    if not isinstance(scope, dict):
        return False
    # Server-provenanced dispatches can execute this Run on another approved host/workspace.
    if "runId" in scope:
        return scope["runId"] == owner["run"]["id"]
    if scope.get("executionHostId") != owner["scope"]["executionHostId"]:
        return False
    return all(key not in scope or scope[key] == owner["scope"].get(key)
               for key in ("projectId", "projectGroupId", "workspaceId"))


def build_run_decisions(client, payload):
    decisions = []
    for owner in read_owned_runs(client):
        run_id = owner["run"]["id"]
        events = [event for event in payload["events"]
                  if event.get("scope", {}).get("actor") != "manager" and
                  scope_matches(event.get("scope"), owner)]
        objectives = [objective for objective in payload["objectives"] if objective["runId"] == run_id]
        if not events and not objectives and not payload["gap"]:
            continue
        if any(objective["workspaceId"] != owner["scope"]["workspaceId"] for objective in objectives):
            raise RuntimeError("Queued objective changed its canonical workspace")
        snapshots = [{**page, "sessions": [row for row in page["sessions"]
                       if isinstance(row, dict) and scope_matches(row.get("scope"), owner)]}
                     for page in payload["snapshot"]]
        decisions.append({"runId": run_id, "run": owner, "cursor": payload["cursor"],
                          "events": events, "objectives": objectives, "gap": payload["gap"],
                          "snapshot": snapshots})
    admitted = {objective["id"] for decision in decisions for objective in decision["objectives"]}
    if admitted != {objective["id"] for objective in payload["objectives"]}:
        raise RuntimeError("Queued objective ownership disappeared before admission")
    return decisions


def decision_prompt_evidence(payload):
    events = [{key: event[key] for key in ("eventId", "kind", "messageId", "occurredAt", "liveness", "outcome")
               if key in event} | {
        "scope": {key: event["scope"][key] for key in ("dispatchId", "sessionId", "sessionGeneration")
                  if key in event["scope"]},
        "summary": event.get("summary", "")[:256]
    } for event in payload["events"]]
    sessions = [row for page in payload["snapshot"] for row in page["sessions"]]
    evidence = {"runId": payload["runId"], "run": {
        "id": payload["run"]["run"]["id"], "objective": payload["run"]["run"]["objective"],
        "scope": payload["run"]["scope"]
    }, "cursor": payload["cursor"], "events": events, "gap": payload["gap"],
        "objectives": [{key: objective[key] for key in ("id", "runId", "workspaceId")}
                       for objective in payload["objectives"]],
        "snapshotCount": len(sessions), "snapshot": [{**row, "summary": row.get("summary", "")[:256]}
                                                     for row in sessions[:20]],
        "eventKinds": dict(Counter(event.get("kind", "unknown") for event in payload["events"]))}
    encoded_size = lambda: len(json.dumps(evidence, ensure_ascii=False).encode("utf-8"))
    while evidence["snapshot"] and encoded_size() > MAX_PROMPT_BYTES:
        evidence["snapshot"].pop()
    evidence["snapshotTruncated"] = len(evidence["snapshot"]) < len(sessions)
    if encoded_size() > MAX_PROMPT_BYTES:
        for event in events:
            event["summary"] = ""
        evidence["eventSummariesOmitted"] = True
    if encoded_size() > MAX_PROMPT_BYTES:
        raise RuntimeError("Decision evidence exceeds its context budget; operator review required")
    return evidence


def publish_decision_report(client, lease, decision_id, payload, result):
    text = result.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Native decision has no confirmed human-readable report")
    body = text.strip()
    encoded = body.encode("utf-16-le")
    if len(encoded) > 31_900 * 2:
        body = encoded[:31_800 * 2].decode("utf-16-le", errors="ignore") + "\n\n[Report truncated. Ask the manager for the relevant details.]"
    response = client.act("conversation-post", {"run": payload["runId"], "body": body, "kind": "reply"},
                          lease=lease, decision_id=decision_id + ":report", step=0)
    message = response.get("message") if isinstance(response, dict) else None
    if (not isinstance(message, dict) or not isinstance(message.get("id"), str) or not message["id"] or
            message.get("runId") != payload["runId"] or message.get("role") != "manager" or
            message.get("kind") != "reply" or message.get("body") != body or response.get("accepted") is not True):
        raise RuntimeError("Manager report publication was not confirmed; replay the same receipt")
