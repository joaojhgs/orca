import importlib
import json
import sys
import types
import unittest
from pathlib import Path

package = types.ModuleType("orca_failure_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
failure = importlib.import_module(package.__name__ + ".orca_failure")


class FailureTests(unittest.TestCase):
    def classify(self, code="manager_forbidden", message=None, operation="worker-start", **fields):
        raw = json.dumps({"ok": False, "error": {"code": code, "message": message, **fields}})
        return failure.classified_failure(raw, operation, 262144)

    def test_known_capacity_refusal_has_only_finite_hints(self):
        for message, reason in failure.CAPACITY_REASONS.items():
            with self.subTest(reason=reason):
                result = self.classify(message=message, data={"credential": "never expose"})
                self.assertEqual(result.diagnostic, {
                    "code": "manager_forbidden", "category": "capacity_wait", "reason": reason})
                self.assertIn("original Task", str(result))
                self.assertNotIn("never expose", str(result))

    def test_capacity_message_is_not_a_launch_receipt_or_permission_override(self):
        result = self.classify(message=next(iter(failure.CAPACITY_REASONS)))
        for field in ["accepted", "launched", "exited", "retry", "requestId", "dispatchId"]:
            self.assertNotIn(field, result.diagnostic)

    def test_capacity_classification_requires_start_operation_and_refusal_code(self):
        message = next(iter(failure.CAPACITY_REASONS))
        self.assertEqual(self.classify(message=message, operation="worker-guide").diagnostic,
                         {"code": "manager_forbidden", "category": "authority_refused"})
        self.assertEqual(self.classify(code="runtime_unavailable", message=message).diagnostic,
                         {"code": "runtime_unavailable", "category": "transport_unavailable"})

    def test_unknown_authority_refusal_does_not_claim_no_worker_started(self):
        result = self.classify(message="arbitrary secret after an uncertain launch")
        self.assertEqual(result.diagnostic, {"code": "manager_forbidden", "category": "authority_refused"})
        self.assertIn("reconcile before retrying", str(result))
        self.assertNotIn("secret", str(result))

    def test_all_known_codes_discard_arbitrary_message_and_data(self):
        for code, category in failure.FAILURE_CATEGORIES.items():
            with self.subTest(code=code):
                result = self.classify(code=code, message="sensitive token", data={"token": "secret"})
                self.assertEqual(result.diagnostic, {"code": code, "category": category})
                self.assertNotIn("sensitive", str(result))
                self.assertNotIn("secret", str(result))

    def test_unknown_codes_and_malformed_envelopes_are_not_trusted(self):
        for raw in ["", "broken", "[]", "null", '{"ok":true,"error":{}}',
                    '{"ok":0,"error":{"code":"forbidden"}}',
                    '{"ok":false,"error":"secret"}',
                    '{"ok":false,"error":{"code":["forbidden"]}}',
                    '{"ok":false,"error":{"code":"secret custom code"}}']:
            with self.subTest(raw=raw):
                self.assertIsNone(failure.classified_failure(raw, "worker-start", 262144))

    def test_read_budget_counts_utf8_bytes_before_parsing(self):
        raw = json.dumps({"ok": False, "error": {"code": "forbidden", "message": "é"}}, ensure_ascii=False)
        self.assertIsNone(failure.classified_failure(raw, "worker-start", len(raw)))
        self.assertIsNotNone(failure.classified_failure(raw, "worker-start", len(raw.encode("utf-8"))))


if __name__ == "__main__":
    unittest.main()
