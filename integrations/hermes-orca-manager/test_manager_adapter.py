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
        self.owner = {"run": {"id": "owned-run", "objective": "Implement it"}, "ownership": "service-principal",
                      "scope": {"executionHostId": "ssh:worker", "workspaceId": "workspace", "projectId": "project"}}
        self.client.inspect.return_value = {"runs": [self.owner], "nextOffset": None}
        self.client.act.side_effect = self.act
        self.client.call.side_effect = self.call
        self.native = Mock(return_value=({"text": "Done"}, "session"))

    def act(self, operation, values, **kwargs):
        if operation == "run-create":
            return {"run": {"id": "owned-run"}}
        return {"accepted": True, "message": {"id": "report", "runId": values["run"],
                "role": "manager", "kind": values["kind"], "body": values["body"]}}

    def call(self, operation, values, *args):
        return {"renewed": True} if operation == "renew" else {"checkpoint": values["cursor"]}

    def event(self, kind="question", run_id="owned-run"):
        return {"eventId": "event:" + run_id, "kind": kind,
                "scope": {**self.owner["scope"], "actor": "worker", "runId": run_id}}

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
        self.page["events"] = [self.event()]
        def call(operation, *args):
            if operation == "checkpoint":
                raise RuntimeError("Disconnected after local receipt")
            return {"renewed": True}
        self.client.call.side_effect = call
        with self.assertRaises(RuntimeError):
            self.process()
        self.assertIsNotNone(self.state.get("pending_batch"))
        self.client.call.side_effect = self.call
        # Newly arriving events must not replace the original durable decision input.
        newer = {**self.page, "cursor": {"journalId": "journal", "sequence": 4}}
        self.process(newer)
        self.native.assert_called_once()
        self.assertEqual(self.state.get("cursor"), self.page["cursor"])
        self.assertIsNone(self.state.get("pending_batch"))

    def test_failed_report_replays_receipt_without_another_model_call(self):
        self.page["events"] = [self.event()]
        self.client.act.side_effect = RuntimeError("Report disconnected")
        with self.assertRaises(RuntimeError):
            self.process()
        self.assertFalse(any(call.args[0] == "checkpoint" for call in self.client.call.call_args_list))
        original = self.client.act.call_args.kwargs["decision_id"]
        self.client.act.side_effect = self.act
        self.process()
        self.native.assert_called_once()
        self.assertEqual(self.client.act.call_args.kwargs["decision_id"], original)
        self.assertEqual(self.state.session_for_run("owned-run"), "session")

    def test_two_objectives_resume_partial_batch_before_new_events(self):
        second = {**self.owner, "run": {"id": "second", "objective": "Independent objective"}}
        self.client.inspect.return_value = {"runs": [self.owner, second], "nextOffset": None}
        self.page["events"] = [self.event(), self.event(run_id="second")]
        self.native.side_effect = [({"text": "First finished"}, "session-a"), RuntimeError("Unavailable")]
        with self.assertRaises(RuntimeError):
            self.process()
        self.assertEqual(self.state.session_for_run("owned-run"), "session-a")
        self.assertIsNone(self.state.session_for_run("second"))
        self.native.side_effect = None
        self.native.return_value = ({"text": "Second finished"}, "session-b")
        self.process({**self.page, "cursor": {"journalId": "journal", "sequence": 20}})
        self.assertEqual([call.args[-1]["runId"] for call in self.native.call_args_list], ["owned-run", "second", "second"])
        self.assertEqual(self.state.session_for_run("second"), "session-b")
        self.assertEqual(self.state.get("cursor"), self.page["cursor"])

    def test_gap_reconciles_all_pages_including_more_than_256_sessions(self):
        self.page["gap"] = "retention-expired"
        sessions = [{"scope": {**self.owner["scope"], "sessionId": str(index)}, "summary": "Unconfirmed"}
                    for index in range(300)]
        snapshots = [{"sessions": sessions[:100], "nextOffset": 100},
                     {"sessions": sessions[100:200], "nextOffset": 200},
                     {"sessions": sessions[200:], "nextOffset": None}]
        self.client.call.side_effect = lambda operation, *args: snapshots.pop(0) if operation == "snapshot" else self.call(operation, *args)
        self.process()
        payload = self.native.call_args.args[-1]
        self.assertEqual(sum(len(page["sessions"]) for page in payload["snapshot"]), 300)
        self.assertEqual(self.state.get("cursor"), self.page["cursor"])

    def test_objective_becomes_idempotent_orca_owned_run_before_model(self):
        self.state.enqueue_objective("request", "workspace", "Implement it")
        self.state.enqueue_objective("request", "workspace", "Implement it")
        with self.assertRaises(ValueError):
            self.state.enqueue_objective("request", "another", "Implement it")
        self.process()
        payload = self.native.call_args.args[-1]
        self.assertEqual(payload["objectives"][0]["runId"], "owned-run")
        self.assertEqual(self.client.act.call_args_list[0].kwargs["decision_id"], "operator-objective:request")
        self.assertEqual(self.state.pending_objectives(), [])

    def test_failed_native_decisions_keep_original_input_and_have_finite_retry_budget(self):
        self.page["events"] = [self.event("dispatch-settled")]
        self.native.side_effect = RuntimeError("Model unavailable")
        for _ in range(4):
            with self.assertRaises(RuntimeError):
                self.process()
        self.assertEqual(self.native.call_count, 3)
        self.assertTrue(all(call.args[0] == "renew" for call in self.client.call.call_args_list))
        self.assertIsNotNone(self.state.get("pending_batch"))

    def test_user_owned_events_cannot_wake_or_adopt_a_run(self):
        self.page["events"] = [self.event(run_id="user-owned")]
        self.process()
        self.native.assert_not_called()
        self.client.act.assert_not_called()

    def test_legacy_ambiguous_session_requires_operator_reconciliation(self):
        self.state.set("pending_decision", {"id": "legacy", "payload": {"events": []}})
        with self.assertRaisesRegex(RuntimeError, "Legacy shared decision"):
            self.process()
        self.native.assert_not_called()
        self.client.call.assert_not_called()

    def test_snapshot_nonadvancing_page_never_checkpoints(self):
        self.page["gap"] = "retention-expired"
        self.client.call.side_effect = None
        self.client.call.return_value = {"sessions": [], "nextOffset": 0}
        with self.assertRaisesRegex(RuntimeError, "did not advance"):
            self.process()
        self.native.assert_not_called()

    def test_unconfirmed_checkpoint_cannot_discard_completed_batch(self):
        self.page["events"] = [self.event()]
        self.client.call.side_effect = lambda operation, *args: {"renewed": True} if operation == "renew" else {}
        with self.assertRaisesRegex(RuntimeError, "checkpoint was not confirmed"):
            self.process()
        self.assertIsNotNone(self.state.get("pending_batch"))
        self.assertIsNone(self.state.get("cursor"))
        self.client.call.side_effect = self.call
        self.process()
        self.native.assert_called_once()

    def test_unconfirmed_renewal_cannot_admit_a_native_decision(self):
        self.page["events"] = [self.event()]
        self.client.call.side_effect = None
        self.client.call.return_value = {"renewed": False}
        with self.assertRaisesRegex(RuntimeError, "renewal was not confirmed"):
            self.process()
        self.native.assert_not_called()

    def test_partial_missing_objective_ownership_never_checkpoints(self):
        self.state.enqueue_objective("first", "workspace", "Implement it")
        self.state.enqueue_objective("second", "workspace", "Another objective")
        def act(operation, values, **kwargs):
            return {"run": {"id": "owned-run" if kwargs["decision_id"].endswith("first") else "vanished"}}
        self.client.act.side_effect = act
        with self.assertRaisesRegex(RuntimeError, "ownership disappeared"):
            self.process()
        self.native.assert_not_called()
        self.client.call.assert_not_called()
        self.assertEqual(len(self.state.pending_objectives()), 2)

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
