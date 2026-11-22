"""Run with the installed Hermes Python and its normal package paths."""
import asyncio
import unittest
from types import SimpleNamespace

from acp_adapter.server import HermesACPAgent


class SessionStore:
    def __init__(self):
        self.state = SimpleNamespace(mode="default")
        self.saved = None

    def get_session(self, _session_id):
        return self.state

    def save_session(self, _session_id):
        self.saved = self.state.mode


class PermissionConfigTest(unittest.TestCase):
    def test_reports_the_saved_policy_and_rejects_unknown_values(self):
        store = SessionStore()
        agent = HermesACPAgent(session_manager=store)
        for policy, mode in [("ask", "default"), ("workspace_session", "accept_edits"),
                             ("session", "dont_ask")]:
            response = asyncio.run(agent.set_config_option(
                "edit_approval_policy", "test-session", policy))
            option = response.config_options[0]
            self.assertEqual(option.id, "edit_approval_policy")
            self.assertEqual(option.category, "mode")
            self.assertEqual(option.current_value, policy)
            self.assertEqual(store.saved, mode)
        with self.assertRaises(ValueError):
            asyncio.run(agent.set_config_option("edit_approval_policy", "test-session", "unknown"))
        self.assertEqual(store.state.mode, "dont_ask")
        self.assertEqual(agent._session_config_options(store.state)[0].current_value, "session")


if __name__ == "__main__":
    unittest.main()
