"""No model calls, remote writes or real account credentials."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

package = types.ModuleType('test_orca_plugin')
package.__path__ = []
sys.modules[package.__name__] = package


class FakeClient:
    def __init__(self, executable='/approved/orca', credential='/approved/credential'):
        self.credential_file = credential
        self.calls = []
        self.project = 'company'
        self.host = 'ssh:ssh-sem-notebook-work'
        self.placement_project = 'company'
        self.agent = 'claude'

    def inspect(self, operation, values):
        if operation == 'session-list':
            return {'sessions': [{'terminal': 'manual', 'incarnationId': 'incarnation', 'agent': self.agent,
                'scope': {'projectId': self.project, 'executionHostId': self.host}}], 'nextOffset': None, 'truncated': False}
        if operation == 'run-show':
            return {'scope': {'projectId': self.project}}
        if operation == 'placements':
            return {'items': [{'workspaceId': 'workspace', 'executionHostId': self.host,
                               'scope': {'projectId': self.placement_project}}]}
        return {'items': []}

    def call(self, operation, values, allowed, **kwargs):
        self.calls.append(operation)
        return {'lease': {'generation': 1}} if operation == 'claim' else {'renewed': True}

    def act(self, operation, values, **kwargs):
        self.calls.append((operation, kwargs['decision_id']))
        return {'accepted': True}


def validate(operation, values, allowed):
    if operation not in allowed or not isinstance(values, dict):
        raise ValueError('Unsupported operation')


manager = types.ModuleType(package.__name__ + '.manager_tools')
manager.schema = lambda *args: {}
manager.client_from_context = lambda ctx: ctx.client
client_module = types.ModuleType(package.__name__ + '.orca_client')
client_module.OrcaClient = FakeClient
client_module.READ_OPERATIONS = {'placements', 'run-show', 'session-list', 'session-read'}
client_module.WRITE_OPERATIONS = {'worker-start', 'run-create', 'session-guide'}
client_module.CONTROL_OPERATIONS = {'claim', 'renew', 'release'}
client_module.validated_arguments = validate
failure = types.ModuleType(package.__name__ + '.orca_failure')
failure.OrcaOperationError = type('OrcaOperationError', (Exception,), {})
for module in (manager, client_module, failure):
    sys.modules[module.__name__] = module
constants = types.ModuleType('hermes_constants')
constants.get_hermes_home = lambda: Path('/home/developer/.hermes/profiles/coordinator')
sys.modules['hermes_constants'] = constants
spec = importlib.util.spec_from_file_location(package.__name__ + '.interactive_tools', Path(__file__).with_name('interactive_tools.py'))
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class Context:
    def __init__(self, cross=False):
        self.client = FakeClient()
        self.cross = cross

    def get_config(self, key, default=None):
        return {'enable_interactive_tools': True, 'enable_cross_profile_delegation': self.cross,
                'orca_executable': '/approved/orca', 'work_project_ids': ['company']}.get(key, default)


class DispatchTests(unittest.TestCase):
    def test_owner_started_personal_session_can_be_guided_without_run(self):
        ctx = Context()
        ctx.client.project, ctx.client.host, ctx.client.agent = 'personal', 'ssh:desktop-personal', 'codex'
        args = {'operation': 'session-guide', 'arguments': {'terminal': 'manual', 'incarnation-id': 'incarnation', 'body': 'Checkpoint safely'}, 'request-id': 'guide-manual-once'}
        self.assertTrue(json.loads(tools.handle(ctx, args, True))['ok'])
        self.assertEqual(ctx.client.calls, ['claim', ('session-guide', 'interactive:guide-manual-once'), 'release'])

    def test_company_guidance_only_to_company_claude_and_raw_output_stays_private(self):
        ctx = Context()
        values = {'terminal': 'manual', 'incarnation-id': 'incarnation', 'body': 'Respond at checkpoint'}
        tools.enforce_company_route(ctx, ctx.client, 'session-guide', values)
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'session-read', values)
        ctx.client.agent = 'codex'
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'session-guide', values)

    def test_stale_identity_wrong_project_host_and_self_guidance_refused(self):
        ctx = Context()
        values = {'terminal': 'manual', 'incarnation-id': 'old'}
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'session-guide', values)
        values['incarnation-id'] = 'incarnation'
        ctx.client.project = 'personal'
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'session-guide', values)
        ctx.client.host, ctx.client.agent = 'ssh:personal', 'hermes'
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'session-guide', values)

    def test_cross_project_placement_rejected_before_claim(self):
        ctx = Context()
        ctx.client.placement_project = 'another-project'
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'worker-start',
                {'run': 'run', 'workspace-id': 'workspace', 'agent': 'claude'})
        self.assertEqual(ctx.client.calls, [])

    def test_personal_never_uses_company_host(self):
        ctx = Context()
        ctx.client.project = ctx.client.placement_project = 'personal'
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'worker-start',
                {'run': 'run', 'workspace-id': 'workspace', 'agent': 'claude'})

    def test_non_manager_cannot_borrow_identity(self):
        with self.assertRaises(ValueError):
            tools.profile_client(Context(False), 'work')
        with patch.object(constants, 'get_hermes_home', return_value=Path('/home/developer/.hermes/profiles/personal')):
            with self.assertRaises(ValueError):
                tools.profile_client(Context(True), 'work')

    def test_manager_can_explicitly_address_work(self):
        self.assertEqual(tools.profile_client(Context(True), 'work').credential_file,
                         '/home/developer/.hermes/profiles/work/orca-manager.credential')

    def test_company_cannot_launch_codex_or_wrong_host(self):
        ctx = Context()
        values = {'run': 'run', 'workspace-id': 'workspace', 'agent': 'codex'}
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'worker-start', values)
        values['agent'] = 'claude'
        ctx.client.host = 'ssh:coding-worker'
        with self.assertRaises(ValueError):
            tools.enforce_company_route(ctx, ctx.client, 'worker-start', values)
        self.assertEqual(ctx.client.calls, [])

    def test_stable_identity_and_lease_release(self):
        ctx = Context()
        args = {'operation': 'worker-start', 'arguments': {'run': 'run', 'workspace-id': 'workspace', 'agent': 'claude'},
                'request-id': 'stable-request-01'}
        result = json.loads(tools.handle(ctx, args, mutate=True))
        self.assertTrue(result['ok'])
        self.assertEqual(ctx.client.calls, ['claim', ('worker-start', 'interactive:stable-request-01'), 'release'])

    def test_failed_action_releases_lease_without_replacement(self):
        ctx = Context()
        with patch.object(ctx.client, 'act', side_effect=RuntimeError('No receipt')):
            result = json.loads(tools.handle(ctx, {'operation': 'run-create', 'arguments': {}, 'request-id': 'stable-request-02'}, True))
        self.assertTrue(result['unconfirmed'])
        self.assertEqual(ctx.client.calls, ['claim', 'release'])


if __name__ == '__main__':
    unittest.main()
