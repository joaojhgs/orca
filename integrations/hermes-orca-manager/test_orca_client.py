import json
import os
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("orca_client", Path(__file__).with_name("orca_client.py"))
client_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client_module)


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def runner(command, **kwargs):
            self.calls.append((command, kwargs))
            return SimpleNamespace(returncode=0, stdout=json.dumps({"ok": True, "result": {"verified": True}}))
        self.client = client_module.OrcaClient("/approved/orca", "/private/manager.json", runner)

    def test_read_is_fixed_typed_and_never_a_shell(self):
        with patch.dict(os.environ, {"ORCA_MANAGER_TOKEN": "ambient-token"}):
            self.assertEqual(self.client.inspect("task-show", {"run": "run1", "task": "$(rm stuff)"}), {"verified": True})
        command, options = self.calls[0]
        self.assertIn("$(rm stuff)", command)
        self.assertFalse(options["shell"])
        self.assertNotIn("ORCA_MANAGER_TOKEN", options["env"])
        self.assertEqual(options["env"]["ORCA_MANAGER_CREDENTIAL_FILE"], "/private/manager.json")

    def test_rejects_admin_arbitrary_flags_and_wrong_types_before_spawn(self):
        for operation, values in [("authorize", {}), ("revoke", {"principal": "x"}),
                                  ("worker-show", {"run": "r"}), ("usage", {"token": "x"}),
                                  ("usage", {"offset": True}), ("run-show", {"run": ["r"]})]:
            with self.assertRaises(ValueError):
                self.client.inspect(operation, values)
        self.assertFalse(self.calls)

    def test_worker_read_cursor_preserves_existing_number_and_incarnation_token_protocol(self):
        for cursor in [0, "opaque-incarnation-cursor"]:
            self.client.inspect("worker-read", {"run": "r", "dispatch": "d", "cursor": cursor})
            command = self.calls[-1][0]
            self.assertEqual(json.loads(command[command.index("--cursor") + 1]), cursor)
        for cursor in [True, -1, {}, ""]:
            with self.assertRaises(ValueError):
                self.client.inspect("worker-read", {"run": "r", "dispatch": "d", "cursor": cursor})

    def test_model_cannot_claim_lease_token_request_id_or_terminal(self):
        for key in ["lease", "request-id", "token", "terminal", "on"]:
            with self.assertRaises(ValueError):
                self.client.act("worker-start", {"run": "r", "task": "t", "workspace-id": "w", "agent": "codex", key: "claimed"}, lease={"generation": 1}, decision_id="d")
        self.assertFalse(self.calls)

    def test_mutation_replays_same_request_across_model_and_consumer_restarts(self):
        for generation in [1, 2]:
            self.client.act("run-create", {"workspace-id": "w", "objective": "Work"}, lease={"generation": generation}, decision_id="durable-decision")
        identifiers = [command[command.index("--request-id") + 1] for command, _ in self.calls]
        self.assertEqual(identifiers[0], identifiers[1])
        self.client.act("run-create", {"workspace-id": "w", "objective": "Other work"}, lease={"generation": 2}, decision_id="durable-decision")
        command = self.calls[-1][0]
        self.assertNotEqual(identifiers[0], command[command.index("--request-id") + 1])

    def test_unconfirmed_and_sensitive_transport_errors_are_not_exposed(self):
        self.client.runner = lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="secret token")
        with self.assertRaisesRegex(RuntimeError, "unavailable") as error:
            self.client.inspect("usage", {})
        self.assertNotIn("secret", str(error.exception))
        self.client.runner = lambda *a, **k: SimpleNamespace(returncode=0, stdout='{"result":{}}')
        with self.assertRaisesRegex(RuntimeError, "Unconfirmed"):
            self.client.inspect("usage", {})


if __name__ == "__main__":
    unittest.main()
