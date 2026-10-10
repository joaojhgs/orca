import importlib
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

package = types.ModuleType("orca_manager_tools_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
tools = importlib.import_module(package.__name__ + ".manager_tools")
state_module = importlib.import_module(package.__name__ + ".manager_state")


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.database = str(Path(self.directory.name) / "state.db")
        self.active = {"id": "decision", "lease": {"generation": 1}, "step": 0,
                       "runId": "owned", "invocationId": "invocation"}
        state = self.open_state()
        state.set("active_decision", self.active)
        state.db.close()
        self.client = Mock()
        self.client.act.return_value = {"accepted": True}
        self.client.inspect.return_value = {"owned": True}
        for replacement in [patch.object(tools, "open_manager_state", self.open_state),
                            patch.object(tools, "client_from_context", return_value=self.client),
                            patch.dict(os.environ, {"ORCA_MANAGER_DECISION_INVOCATION": "invocation"})]:
            replacement.start()
            self.addCleanup(replacement.stop)

    def open_state(self):
        return state_module.ManagerState(sqlite3.connect(self.database))

    def invoke(self, operation="task-create", values=None, mutate=True):
        return json.loads(tools.handle(None, {"operation": operation,
            "arguments": values if values is not None else {"run": "owned", "spec": "Task"}}, mutate))

    def test_stale_invocation_cannot_borrow_new_context_for_reads_or_mutations(self):
        with patch.dict(os.environ, {"ORCA_MANAGER_DECISION_INVOCATION": "old-invocation"}):
            self.assertFalse(self.invoke()["ok"])
            self.assertFalse(self.invoke("run-show", {"run": "owned"}, False)["ok"])
        self.client.act.assert_not_called()
        self.client.inspect.assert_not_called()

    def test_cross_run_and_run_creation_or_listing_are_forbidden(self):
        for operation, values, mutate in [
            ("task-create", {"run": "another", "spec": "Task"}, True),
            ("worker-show", {"run": "another", "dispatch": "dispatch"}, False),
            ("run-create", {"workspace-id": "workspace", "objective": "New"}, True),
            ("run-list", {}, False),
        ]:
            self.assertFalse(self.invoke(operation, values, mutate)["ok"])
        self.client.act.assert_not_called()
        self.client.inspect.assert_not_called()

    def test_missing_context_refuses_tools(self):
        state = self.open_state()
        state.set("active_decision", None)
        state.db.close()
        self.assertFalse(self.invoke()["ok"])
        self.client.act.assert_not_called()

    def test_successful_step_replays_known_receipt_after_native_restart(self):
        self.assertEqual(self.invoke(), {"ok": True, "result": {"accepted": True}, "replayed": False})
        state = self.open_state()
        state.set("active_decision", {**self.active, "invocationId": "replacement"})
        state.db.close()
        with patch.dict(os.environ, {"ORCA_MANAGER_DECISION_INVOCATION": "replacement"}):
            self.assertTrue(self.invoke()["replayed"])
        self.client.act.assert_called_once()

    def test_changed_restart_action_is_not_replayed(self):
        self.assertTrue(self.invoke()["ok"])
        state = self.open_state()
        state.set("active_decision", self.active)
        state.db.close()
        self.assertFalse(self.invoke(values={"run": "owned", "spec": "Different task"})["ok"])
        self.client.act.assert_called_once()

    def test_replacement_during_network_call_cannot_be_overwritten(self):
        replacement = {**self.active, "invocationId": "replacement", "lease": {"generation": 2}}
        def act(*args, **kwargs):
            state = self.open_state()
            state.set("active_decision", replacement)
            state.db.close()
            return {"accepted": True}
        self.client.act.side_effect = act
        self.assertFalse(self.invoke()["ok"])
        state = self.open_state()
        self.assertEqual(state.get("active_decision"), replacement)
        self.assertEqual(state.step_result("decision", 0), {"result": {"accepted": True}})
        state.db.close()

    def test_tool_schema_does_not_offer_another_run_creation_or_listing(self):
        ctx = Mock()
        tools.register_manager_tools(ctx)
        calls = ctx.register_tool.call_args_list
        enums = [call.kwargs["schema"]["parameters"]["properties"]["operation"]["enum"] for call in calls]
        self.assertNotIn("run-list", enums[0])
        self.assertNotIn("run-create", enums[1])

    def test_concurrent_mutations_use_distinct_ordered_durable_steps(self):
        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / "state.db")
            def open_state():
                return state_module.ManagerState(sqlite3.connect(database))
            state = open_state()
            state.set("active_decision", self.active)
            state.db.close()
            steps = []
            def act(*args, **kwargs):
                steps.append(kwargs["step"])
                time.sleep(0.03)
                return {"accepted": True}
            client = Mock()
            client.act.side_effect = act
            ready = threading.Barrier(2)
            def invoke(index):
                ready.wait(timeout=2)
                return json.loads(tools.handle(None, {"operation": "task-create",
                    "arguments": {"run": "owned", "spec": f"Task {index}"}}, True))
            with patch.object(tools, "open_manager_state", open_state), \
                 patch.object(tools, "client_from_context", return_value=client), \
                 ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(invoke, [1, 2]))
            self.assertTrue(all(result["ok"] for result in results))
            self.assertEqual(steps, [0, 1])
            state = open_state()
            self.assertEqual(state.get("active_decision")["step"], 2)
            self.assertEqual(state.db.execute("SELECT count(*) FROM decision_steps").fetchone()[0], 2)
            state.db.close()


if __name__ == "__main__":
    unittest.main()
