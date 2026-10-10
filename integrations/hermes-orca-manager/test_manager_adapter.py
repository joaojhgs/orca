import importlib
import json
import sqlite3
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

package = types.ModuleType("orca_manager_adapter_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
adapter = importlib.import_module(package.__name__ + ".manager_adapter")
state_module = importlib.import_module(package.__name__ + ".manager_state")
runner = importlib.import_module(package.__name__ + ".decision_runner")


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.state = state_module.ManagerState(sqlite3.connect(":memory:"))
        self.lease = {"principalId": "manager", "consumerId": "consumer", "generation": 1}
        self.page = {"cursor": {"journalId": "journal", "sequence": 1}, "events": [], "gap": None}
        self.client = Mock()
        self.native = Mock(return_value=({"text": "Done"}, "session"))

    def tearDown(self):
        self.state.db.close()

    def process(self, page=None):
        adapter.process_page(None, self.client, self.state, self.lease, page or self.page, native_decision=self.native)

    def test_idle_or_self_events_do_not_invoke_model_and_unchanged_cursor_does_not_write(self):
        self.process()
        self.process()
        self.native.assert_not_called()
        self.assertEqual(self.client.call.call_count, 1)
        self.page["events"] = [{"scope": {"actor": "manager"}}]
        self.process()
        self.native.assert_not_called()

    def test_completed_receipt_survives_failed_ack_without_second_model_decision(self):
        self.page["events"] = [{"kind": "question", "scope": {"actor": "worker"}}]
        self.client.call.side_effect = RuntimeError("Disconnected after local receipt")
        with self.assertRaises(RuntimeError):
            self.process()
        self.assertIsNotNone(self.state.get("pending_decision"))
        self.client.call.side_effect = None
        # Newly arriving events must not replace the original durable decision input.
        newer = {**self.page, "cursor": {"journalId": "journal", "sequence": 4}}
        self.process(newer)
        self.native.assert_called_once()
        self.assertEqual(self.state.get("cursor"), self.page["cursor"])
        self.assertIsNone(self.state.get("pending_decision"))

    def test_gap_reconciles_all_pages_including_more_than_256_sessions(self):
        self.page["gap"] = "retention-expired"
        snapshots = [{"sessions": list(range(100)), "nextOffset": 100},
                     {"sessions": list(range(100, 200)), "nextOffset": 200},
                     {"sessions": list(range(200, 300)), "nextOffset": None}]
        self.client.call.side_effect = [*snapshots, {"checkpoint": True}]
        self.process()
        payload = self.native.call_args.args[-1]
        self.assertEqual(sum(len(page["sessions"]) for page in payload["snapshot"]), 300)
        self.assertEqual(self.state.get("cursor"), self.page["cursor"])

    def test_objective_becomes_idempotent_orca_owned_run_before_model(self):
        self.state.enqueue_objective("request", "workspace", "Implement it")
        self.state.enqueue_objective("request", "workspace", "Implement it")
        with self.assertRaises(ValueError):
            self.state.enqueue_objective("request", "another", "Implement it")
        self.client.act.return_value = {"run": {"id": "owned-run"}}
        self.process()
        payload = self.native.call_args.args[-1]
        self.assertEqual(payload["objectives"][0]["runId"], "owned-run")
        self.assertEqual(self.client.act.call_args.kwargs["decision_id"], "operator-objective:request")
        self.assertEqual(self.state.pending_objectives(), [])

    def test_failed_native_decisions_keep_original_input_and_have_finite_retry_budget(self):
        self.page["events"] = [{"kind": "dispatch-settled", "scope": {"actor": "worker"}}]
        self.native.side_effect = RuntimeError("Model unavailable")
        for _ in range(4):
            with self.assertRaises(RuntimeError):
                self.process()
        self.assertEqual(self.native.call_count, 3)
        self.client.call.assert_not_called()
        self.assertIsNotNone(self.state.get("pending_decision"))

    def test_step_receipts_refuse_changed_actions_after_restart(self):
        self.state.admit_step("decision", 0, "worker-start", {"task": "t"})
        self.state.admit_step("decision", 0, "worker-start", {"task": "t"})
        with self.assertRaises(ValueError):
            self.state.admit_step("decision", 0, "worker-start", {"task": "another"})

    def test_native_output_needs_one_successful_result_and_exact_session(self):
        record = {"type": "result", "exit_code": 0, "session_id": "session", "text": "Done"}
        valid = json.dumps(record).encode()
        self.assertEqual(runner.parse_native_result(valid, 0)[1], "session")
        for raw, code in [(valid, 1), (b"no result", 0), (valid + b"\n" + valid, 0),
                          (json.dumps({**record, "exit_code": 1}).encode(), 0),
                          (json.dumps({**record, "session_id": None}).encode(), 0)]:
            with self.assertRaises(RuntimeError):
                runner.parse_native_result(raw, code)


if __name__ == "__main__":
    unittest.main()
