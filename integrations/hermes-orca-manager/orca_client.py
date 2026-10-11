"""Typed CLI transport. The model never supplies an executable, token, lease or shell."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess

READ_OPERATIONS = {
    "placements": (set(), {"offset", "limit"}),
    "usage": (set(), {"offset", "limit"}),
    "resources": (set(), {"offset", "limit"}),
    "run-list": (set(), {"offset", "limit"}),
    "run-show": ({"run"}, set()),
    "task-list": ({"run"}, {"offset", "limit"}),
    "task-show": ({"run", "task"}, set()),
    "worker-show": ({"run", "dispatch"}, set()),
    "worker-read": ({"run", "dispatch"}, {"cursor", "limit"}),
    "conversation-read": ({"run"}, {"after-sequence", "limit"}),
}
WRITE_OPERATIONS = {
    "run-create": ({"workspace-id", "objective"}, set()),
    "task-create": ({"run", "spec"}, {"title", "deps", "parent", "requirements"}),
    "worker-start": ({"run", "task", "workspace-id", "agent"}, {"model", "effort", "retry-of"}),
    "worker-guide": ({"run", "dispatch", "body"}, set()),
    "question-answer": ({"run", "message", "body"}, set()),
    "conversation-post": ({"run", "body"}, {"kind", "reply-to", "completion-evidence"}),
}
CONTROL_OPERATIONS = {
    "read": (set(), {"cursor", "limit"}),
    "wait": (set(), {"cursor", "timeout-ms"}),
    "snapshot": (set(), {"offset", "limit"}),
    "claim": ({"consumer"}, {"duration-ms"}),
    "renew": ({"lease"}, {"duration-ms"}),
    "release": ({"lease"}, set()),
    "checkpoint": ({"lease", "cursor"}, set()),
    "check": ({"lease", "run"}, {"limit"}),
    "ack": ({"lease", "run", "delivery"}, set()),
}
MAX_RESULT = 256 * 1024


def renew_manager_lease(client, lease):
    response = client.call("renew", {"lease": lease, "duration-ms": 60_000}, CONTROL_OPERATIONS)
    if not isinstance(response, dict) or response.get("renewed") is not True:
        raise RuntimeError("Manager lease renewal was not confirmed")


def validated_arguments(operation, values, allowed):
    if operation not in allowed or not isinstance(values, dict):
        raise ValueError("Unsupported Orca manager operation")
    required, optional = allowed[operation]
    if not required <= set(values) or set(values) - required - optional:
        raise ValueError("Missing or unsupported manager arguments")
    result = []
    for key, value in sorted(values.items()):
        if key in {"lease", "cursor"}:
            worker_cursor = operation == "worker-read" and key == "cursor"
            if worker_cursor and (isinstance(value, bool) or not isinstance(value, (str, int)) or
                                  isinstance(value, int) and value < 0 or isinstance(value, str) and not 1 <= len(value) <= 2048):
                raise ValueError("Invalid incarnation-fenced worker cursor")
            if not worker_cursor and not isinstance(value, dict):
                raise ValueError("Invalid manager cursor or lease")
            value = json.dumps(value, separators=(",", ":"))
        elif key in {"offset", "limit", "timeout-ms", "duration-ms", "after-sequence"}:
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError("Invalid manager numeric argument")
            value = str(value)
        elif not isinstance(value, str) or not value or len(value) > 32768 or "\0" in value:
            raise ValueError("Invalid manager text argument")
        result.extend([f"--{key}", value])
    return result


class OrcaClient:
    def __init__(self, executable, credential_file, runner=subprocess.run):
        if not os.path.isabs(executable) or not os.path.isabs(credential_file):
            raise ValueError("Operator must configure absolute CLI and private credential paths")
        self.executable = executable
        self.credential_file = credential_file
        self.runner = runner

    def call(self, operation, values, allowed, *, timeout=45, lease=None, request_id=None):
        arguments = validated_arguments(operation, values, allowed)
        if operation in WRITE_OPERATIONS:
            if lease is None or request_id is None:
                raise ValueError("Mutation requires adapter-owned decision and consumer lease")
            arguments.extend(["--lease", json.dumps(lease), "--request-id", request_id])
        environment = os.environ.copy()
        # The configured service credential overrides ambient owner/other-manager credentials.
        environment.pop("ORCA_MANAGER_TOKEN", None)
        environment["ORCA_MANAGER_CREDENTIAL_FILE"] = self.credential_file
        environment["ORCA_BACKGROUND_LAUNCH"] = "1"
        result = self.runner([self.executable, "manager", operation, *arguments, "--json"],
                             env=environment, capture_output=True, text=True, timeout=timeout,
                             check=False, shell=False)
        if result.returncode != 0:
            # Never echo transport stderr: it can contain credential paths or host data.
            raise RuntimeError("Orca manager operation unavailable; reconcile before retrying")
        if len(result.stdout.encode("utf-8")) > MAX_RESULT:
            raise RuntimeError("Orca response exceeds manager read budget")
        response = json.loads(result.stdout)
        if not isinstance(response, dict) or response.get("ok") is not True or "result" not in response:
            raise RuntimeError("Unconfirmed Orca response")
        return response["result"]

    def inspect(self, operation, values):
        return self.call(operation, values, READ_OPERATIONS)

    def act(self, operation, values, *, lease, decision_id, step=None):
        identity = [decision_id, "step", step] if step is not None else [decision_id, operation, values]
        payload = json.dumps(identity, sort_keys=True, separators=(",", ":"))
        request_id = "hermes:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return self.call(operation, values, WRITE_OPERATIONS, timeout=130,
                         lease=lease, request_id=request_id)
