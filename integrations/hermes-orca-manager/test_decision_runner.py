import importlib
import json
import os
import sqlite3
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

package = types.ModuleType("orca_native_decision_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
runner = importlib.import_module(package.__name__ + ".decision_runner")
state_module = importlib.import_module(package.__name__ + ".manager_state")


class NativeDecisionTests(unittest.TestCase):
    def setUp(self):
        self.state = state_module.ManagerState(sqlite3.connect(":memory:"))
        self.addCleanup(self.state.db.close)
        self.client = Mock()
        self.client.call.return_value = {"renewed": True}
        self.ctx = Mock()
        self.config = {"hermes_executable": "/operator/hermes", "max_session_decisions": 12}
        self.ctx.get_config.side_effect = lambda key, default=None: self.config.get(key, default)
        self.payload = {"runId": "owned", "run": {"run": {"id": "owned", "objective": "Objective"},
            "scope": {"executionHostId": "ssh:worker", "workspaceId": "workspace"}},
            "cursor": {"sequence": 1}, "events": [], "snapshot": [], "gap": None, "objectives": []}
        self.process = Mock()
        self.process.poll.return_value = 0
        self.process.returncode = 0
        self.record = {"type": "result", "exit_code": 0, "session_id": "native", "text": "Done"}

    def spawn(self, command, **kwargs):
        kwargs["stdout"].write(json.dumps(self.record).encode())
        self.command, self.environment = command, kwargs["env"]
        self.assertFalse(kwargs["shell"])
        return self.process

    def run_native(self):
        return runner.run_native_decision(self.ctx, self.client, self.state, {"generation": 1}, "decision", self.payload)

    def remember(self, identifier, run_id, session):
        self.state.begin_decision(identifier, {"runId": run_id})
        self.state.complete_decision(identifier, {"text": "Done"}, session, run_id)

    def test_only_this_runs_session_resumes_and_ambient_token_is_removed(self):
        self.state.set("manager_session", "legacy-shared")
        self.remember("before", "owned", "own-session")
        self.remember("other", "another", "other-session")
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn), \
             patch.dict(os.environ, {"ORCA_MANAGER_TOKEN": "ambient-owner-token"}):
            self.assertEqual(self.run_native()[1], "native")
        self.assertEqual(self.command[-2:], ["--resume", "own-session"])
        self.assertNotIn("other-session", self.command)
        self.assertNotIn("legacy-shared", self.command)
        self.assertNotIn("ORCA_MANAGER_TOKEN", self.environment)
        self.assertEqual(self.environment["ORCA_BACKGROUND_LAUNCH"], "1")
        self.assertEqual(len(self.environment["ORCA_MANAGER_DECISION_INVOCATION"]), 32)
        self.assertIsNone(self.state.get("active_decision"))
        self.client.call.assert_called_once()

    def test_session_rotation_starts_fresh_at_limit_without_losing_receipts(self):
        self.config["max_session_decisions"] = 2
        self.remember("first", "owned", "old-session")
        self.remember("second", "owned", "old-session")
        self.assertIsNone(self.state.session_for_run("owned", 2))
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn):
            self.run_native()
        self.assertNotIn("--resume", self.command)
        self.remember("third", "owned", "new-session")
        self.assertEqual(self.state.session_for_run("owned", 2), "new-session")
        self.assertTrue(self.state.begin_decision("first", {"runId": "owned"})["completed"])

    def test_completion_cannot_bind_another_runs_context(self):
        self.state.begin_decision("decision", {"runId": "owned"})
        with self.assertRaisesRegex(ValueError, "another objective"):
            self.state.complete_decision("decision", {"text": "Done"}, "session", "another")
        self.assertFalse(self.state.begin_decision("decision", {"runId": "owned"})["completed"])
        self.assertIsNone(self.state.session_for_run("another"))

    def test_spawn_failure_clears_only_its_admission(self):
        with patch.object(runner.subprocess, "Popen", side_effect=OSError("Missing executable")):
            with self.assertRaises(OSError):
                self.run_native()
        self.assertIsNone(self.state.get("active_decision"))

    def test_replaced_admission_is_never_cleared_by_old_process(self):
        replacement = {"invocationId": "replacement", "runId": "other"}
        def renew(*args):
            self.state.set("active_decision", replacement)
            return {"renewed": True}
        self.client.call.side_effect = renew
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn):
            self.run_native()
        self.assertEqual(self.state.get("active_decision"), replacement)

    def test_revocation_refuses_successful_native_result(self):
        self.client.call.side_effect = RuntimeError("Revoked")
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn):
            with self.assertRaisesRegex(RuntimeError, "Revoked"):
                self.run_native()
        self.assertIsNone(self.state.get("active_decision"))

    def test_unconfirmed_renewal_refuses_successful_native_result(self):
        self.client.call.return_value = {}
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn):
            with self.assertRaisesRegex(RuntimeError, "renewal was not confirmed"):
                self.run_native()
        self.assertIsNone(self.state.get("active_decision"))

    def test_timeout_terminates_only_owned_native_process(self):
        self.process.poll.return_value = None
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn), \
             patch.object(runner.time, "monotonic", side_effect=[0, 901]):
            with self.assertRaisesRegex(RuntimeError, "time budget"):
                self.run_native()
        self.process.terminate.assert_called_once()
        self.process.wait.assert_called_once_with(timeout=10)
        self.process.kill.assert_not_called()
        self.assertIsNone(self.state.get("active_decision"))

    def test_invalid_limits_or_missing_operator_executable_fail_before_admission(self):
        for limit in [True, 0, 21, "12"]:
            self.config["max_session_decisions"] = limit
            with self.assertRaises(ValueError):
                self.run_native()
            self.assertIsNone(self.state.get("active_decision"))
        self.config = {}
        with self.assertRaisesRegex(ValueError, "operator-configured"):
            self.run_native()

    def test_empty_native_report_is_not_marked_successful(self):
        self.record["text"] = " "
        with patch.object(runner.subprocess, "Popen", side_effect=self.spawn):
            with self.assertRaisesRegex(RuntimeError, "report was not confirmed"):
                self.run_native()


if __name__ == "__main__":
    unittest.main()
