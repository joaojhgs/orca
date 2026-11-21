import importlib.util
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import sys

ROOT = Path(__file__).parent
PACKAGE = 'interactive_event_fixture'
if PACKAGE not in sys.modules:
    module = ModuleType(PACKAGE)
    module.__path__ = [str(ROOT)]
    sys.modules[PACKAGE] = module
spec = importlib.util.spec_from_file_location(PACKAGE + '.event_tools', ROOT / 'event_tools.py')
events = importlib.util.module_from_spec(spec)
spec.loader.exec_module(events)


class EventToolTests(unittest.TestCase):
    def context(self, enabled=True):
        settings = {'enable_event_tools': enabled, 'orca_executable': '/operator/orca',
                    'orca_credential_file': '/private/service.json'}
        return SimpleNamespace(get_config=lambda key, default=None: settings.get(key, default))

    def test_native_session_can_read_and_wait_without_a_manager_decision(self):
        with patch.object(events, 'OrcaClient') as client:
            cursor = {'journalId': 'fixture-journal', 'sequence': 1}
            client.return_value.call.return_value = {'events': [], 'cursor': cursor}
            for wait in (False, True):
                response = json.loads(events.read_events(self.context(), {'cursor': cursor}, wait))
                self.assertTrue(response['ok'])
            self.assertEqual([call.args[0] for call in client.return_value.call.call_args_list], ['read', 'wait'])

    def test_disabled_and_mutating_or_over_budget_arguments_never_reach_transport(self):
        with patch.object(events, 'OrcaClient') as client:
            for args, wait in [({'lease': {}}, False), ({'limit': 201}, False),
                               ({'timeout-ms': 20001}, True), ({'limit': True}, False),
                               ({'cursor': {'sequence': 1}}, False),
                               ({'cursor': {'journalId': 'fixture', 'sequence': True}}, True)]:
                self.assertFalse(json.loads(events.read_events(self.context(), args, wait))['ok'])
            self.assertFalse(json.loads(events.read_events(self.context(False), {}))['ok'])
            client.assert_not_called()

    def test_unavailable_transport_never_returns_diagnostics_or_credentials(self):
        with patch.object(events, 'OrcaClient', side_effect=RuntimeError('secret fixture')):
            response = events.read_events(self.context(), {})
            self.assertNotIn('secret fixture', response)
            self.assertFalse(json.loads(response)['ok'])


if __name__ == '__main__':
    unittest.main()
