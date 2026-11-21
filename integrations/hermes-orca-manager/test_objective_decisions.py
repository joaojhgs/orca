import copy
import importlib
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

package = types.ModuleType("orca_objective_decision_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
decisions = importlib.import_module(package.__name__ + ".objective_decisions")


class ObjectiveDecisionTests(unittest.TestCase):
    def setUp(self):
        self.owner = {"run": {"id": "owned", "objective": "The complete objective"},
                      "ownership": "service-principal",
                      "scope": {"executionHostId": "ssh:desktop", "workspaceId": "repo:main", "projectId": "project"}}
        self.client = Mock()
        self.client.inspect.return_value = {"runs": [self.owner], "nextOffset": None}
        self.payload = {"cursor": {"sequence": 10}, "events": [], "objectives": [], "gap": None, "snapshot": []}

    def event(self, scope):
        return {"kind": "mail", "eventId": "event", "messageId": "mail", "scope": scope, "summary": "Evidence"}

    def test_owned_run_events_follow_dispatches_across_hosts_and_worktrees(self):
        scope = {"executionHostId": "ssh:worker", "workspaceId": "repo:child", "runId": "owned", "actor": "worker"}
        self.payload["events"] = [self.event(scope)]
        routed = decisions.build_run_decisions(self.client, self.payload)
        self.assertEqual(routed[0]["events"], self.payload["events"])
        self.assertEqual(routed[0]["runId"], "owned")

    def test_unowned_run_cannot_be_routed_by_matching_host_and_workspace(self):
        self.payload["events"] = [self.event({**self.owner["scope"], "runId": "user", "actor": "worker"})]
        self.assertEqual(decisions.build_run_decisions(self.client, self.payload), [])

    def test_host_contact_events_fan_out_only_to_owned_runs_on_that_host(self):
        other = {**self.owner, "run": {"id": "second", "objective": "Second"}}
        elsewhere = {**self.owner, "run": {"id": "elsewhere", "objective": "Elsewhere"},
                     "scope": {**self.owner["scope"], "executionHostId": "ssh:worker"}}
        self.client.inspect.return_value = {"runs": [self.owner, other, elsewhere], "nextOffset": None}
        self.payload["events"] = [self.event({"executionHostId": "ssh:desktop", "actor": "root"})]
        self.assertEqual([row["runId"] for row in decisions.build_run_decisions(self.client, self.payload)], ["owned", "second"])

    def test_manager_self_events_do_not_wake_model(self):
        self.payload["events"] = [self.event({**self.owner["scope"], "runId": "owned", "actor": "manager"})]
        self.assertEqual(decisions.build_run_decisions(self.client, self.payload), [])

    def test_gap_snapshots_do_not_leak_other_objective_sessions(self):
        self.payload["gap"] = "expired"
        included = {"scope": {"runId": "owned", "executionHostId": "ssh:worker"}, "summary": "My worker"}
        excluded = {"scope": {**self.owner["scope"], "runId": "someone-else"}, "summary": "Other objective"}
        self.payload["snapshot"] = [{"sessions": [included, excluded], "nextOffset": None}]
        routed = decisions.build_run_decisions(self.client, self.payload)
        self.assertEqual(routed[0]["snapshot"][0]["sessions"], [included])

    def test_complete_pagination_and_duplicate_or_invalid_ownership_fail_closed(self):
        self.client.inspect.side_effect = [
            {"runs": [self.owner], "nextOffset": 100},
            {"runs": [{**self.owner, "run": {"id": "second", "objective": "Second"}}], "nextOffset": None},
        ]
        self.assertEqual(len(decisions.read_owned_runs(self.client)), 2)
        self.assertEqual(self.client.inspect.call_args.args[1]["offset"], 100)
        self.client.inspect.side_effect = None
        for rows in [[self.owner, self.owner], [None], [{**self.owner, "ownership": "user"}]]:
            self.client.inspect.return_value = {"runs": rows, "nextOffset": None}
            with self.assertRaisesRegex(RuntimeError, "needs reconciliation"):
                decisions.read_owned_runs(self.client)
        self.client.inspect.return_value = {"runs": [], "nextOffset": 0}
        with self.assertRaisesRegex(RuntimeError, "did not advance"):
            decisions.read_owned_runs(self.client)

    def test_queued_objective_must_keep_canonical_workspace(self):
        self.payload["objectives"] = [{"id": "request", "runId": "owned", "workspaceId": "wrong"}]
        with self.assertRaisesRegex(RuntimeError, "canonical workspace"):
            decisions.build_run_decisions(self.client, self.payload)

    def test_prompt_preserves_event_receipts_but_samples_snapshot_without_mutating_input(self):
        self.payload["events"] = [self.event({**self.owner["scope"], "runId": "owned", "actor": "worker"})]
        self.payload["gap"] = "expired"
        self.payload["snapshot"] = [{"sessions": [{"scope": self.owner["scope"], "summary": "x" * 1000} for _ in range(300)]}]
        routed = decisions.build_run_decisions(self.client, self.payload)[0]
        original = copy.deepcopy(routed)
        evidence = decisions.decision_prompt_evidence(routed)
        self.assertEqual(evidence["snapshotCount"], 300)
        self.assertEqual(len(evidence["snapshot"]), 20)
        self.assertTrue(evidence["snapshotTruncated"])
        self.assertEqual(evidence["events"][0]["messageId"], "mail")
        self.assertEqual(evidence["run"]["objective"], "The complete objective")
        self.assertEqual(routed, original)
        self.assertLess(len(json.dumps(evidence, ensure_ascii=False).encode()), decisions.MAX_PROMPT_BYTES)

    def test_oversized_canonical_evidence_is_not_silently_dropped(self):
        self.payload["gap"] = "expired"
        routed = decisions.build_run_decisions(self.client, self.payload)[0]
        routed["run"]["run"]["objective"] = "🙂" * decisions.MAX_PROMPT_BYTES
        with self.assertRaisesRegex(RuntimeError, "context budget"):
            decisions.decision_prompt_evidence(routed)

    def test_report_receipt_requires_same_run_role_and_kind(self):
        good = {"accepted": True, "message": {"id": "report", "runId": "owned", "role": "manager", "kind": "reply", "body": "Done"}}
        self.client.act.return_value = good
        payload = {"runId": "owned"}
        decisions.publish_decision_report(self.client, {}, "decision", payload, {"text": "Done"})
        self.assertEqual(self.client.act.call_args.kwargs["decision_id"], "decision:report")
        for bad in [None, {**good, "accepted": False}, {**good, "message": {**good["message"], "runId": "another"}},
                    {**good, "message": {**good["message"], "role": "human"}},
                    {**good, "message": {**good["message"], "body": "Different report"}}]:
            self.client.act.return_value = bad
            with self.assertRaisesRegex(RuntimeError, "not confirmed"):
                decisions.publish_decision_report(self.client, {}, "decision", payload, {"text": "Done"})

    def test_long_unicode_report_respects_javascript_length_budget(self):
        self.client.act.side_effect = lambda operation, values, **kwargs: {"accepted": True,
            "message": {"id": "report", "runId": "owned", "role": "manager", "kind": "reply", "body": values["body"]}}
        decisions.publish_decision_report(self.client, {}, "decision", {"runId": "owned"}, {"text": "🙂" * 32768})
        body = self.client.act.call_args.args[1]["body"]
        self.assertLess(len(body.encode("utf-16-le")) // 2, 32768)
        self.assertIn("Report truncated", body)


if __name__ == "__main__":
    unittest.main()
