"""Standard CLI authority must not silently become the service manager identity."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('public_cli_fixture', Path(__file__).with_name('public_cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class Context:
    def get_config(self, key, default=None):
        return {'use_standard_cli': True,
                'orca_mailbox_address': 'hermes:coding',
                'orca_public_executable': '/home/developer/.orca-relay/bin/orca'}.get(key, default)


class PublicCliTests(unittest.TestCase):
    def test_gateway_delegation_has_its_own_mailbox_without_borrowing_a_terminal(self):
        ctx = type('Gateway', (), {'get_config': lambda self, key, default=None:
                                  {'orca_mailbox_address': 'hermes:work'}.get(key, default)})()
        self.assertEqual(cli.profile_mail_arguments(ctx,
                         ['orchestration', 'send', '--to', 'company', '--type', 'question'], {}),
                         ['orchestration', 'send', '--to', 'company', '--type', 'question',
                          '--from', 'hermes:work'])
        self.assertEqual(cli.profile_mail_arguments(ctx, ['orchestration', 'inbox'], {}),
                         ['orchestration', 'inbox', '--terminal', 'hermes:work'])
        for args in [['orchestration', 'send', '--from', 'somebody-else'],
                     ['orchestration', 'send', '--type', 'worker_done']]:
            with self.assertRaises(ValueError):
                cli.profile_mail_arguments(ctx, args, {})

    def test_real_terminal_identity_is_preserved_instead_of_using_gateway_mailbox(self):
        args = ['orchestration', 'send', '--to', 'company']
        self.assertEqual(cli.profile_mail_arguments(Context(), args,
                                                   {'ORCA_TERMINAL_HANDLE': 'own-terminal'}), args)

    def test_existing_owner_run_uses_public_cli_not_manager_or_lease(self):
        calls = []
        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, json.dumps({'ok': True}), '')
        with patch.dict(os.environ, {'ORCA_MANAGER_TOKEN': 'private',
                                    'ORCA_MANAGER_CREDENTIAL_FILE': '/private'}):
            result = cli.execute(Context(), ['orchestration', 'run-show', '--id', 'owner-run'], runner)
        self.assertEqual(result['exitCode'], 0)
        argv, options = calls[0]
        self.assertEqual(argv[1:], ['orchestration', 'run-show', '--id', 'owner-run', '--json'])
        self.assertFalse(options['shell'])
        self.assertNotIn('ORCA_MANAGER_TOKEN', options['env'])
        self.assertNotIn('ORCA_MANAGER_CREDENTIAL_FILE', options['env'])

    def test_rejects_shell_strings_and_invalid_arguments_before_execution(self):
        for argv in ('orca orchestration run-list', [], ['a\0b'], [1]):
            with self.assertRaises(ValueError):
                cli.execute(Context(), argv, lambda *args, **kwargs: self.fail('must not execute'))

    def test_mutation_failure_is_not_reported_as_success(self):
        result = cli.execute(Context(), ['orchestration', 'worker-start'],
                             lambda *args, **kwargs: subprocess.CompletedProcess(args, 1, '{"ok":false}', ''))
        self.assertEqual(result['exitCode'], 1)
        self.assertFalse(result['response']['ok'])

    def test_skill_json_without_rpc_envelope_is_a_successful_cli_read(self):
        result = cli.execute(Context(), ['skills', 'get', 'orca-cli'],
                             lambda *a, **k: subprocess.CompletedProcess(a, 0,
                                 '{"name":"orca-cli","markdown":"guide"}', ''))
        self.assertTrue(result['success'])

    def test_large_responses_require_pagination(self):
        with self.assertRaisesRegex(ValueError, 'budget'):
            cli.execute(Context(), ['list'], lambda *args, **kwargs:
                        subprocess.CompletedProcess(args, 0, 'x' * (256 * 1024 + 1), ''))

    def test_large_inventory_can_be_selected_without_shell_scripts(self):
        response = {'ok': True, 'result': {'workers': [
            {'spec': 'x' * 300000, 'projection': {'id': 'existing', 'outcome': 'failed'}}],
            'page': {'hasMore': False}}}
        result = cli.execute(Context(), ['orchestration', 'worker-list'],
                             lambda *a, **k: subprocess.CompletedProcess(a, 0, json.dumps(response), ''),
                             select=['result.workers[].projection', 'result.page'])
        self.assertTrue(result['success'])
        self.assertEqual(result['response']['result']['result.workers[].projection'],
                         [{'id': 'existing', 'outcome': 'failed'}])
        self.assertLess(len(json.dumps(result)), 1000)

    def test_selection_on_mutations_is_rejected_before_execution(self):
        with self.assertRaises(ValueError):
            cli.execute(Context(), ['terminal', 'send'],
                        lambda *a, **k: self.fail('must not execute'), select=['result'])

    def test_native_tool_exposes_explicit_top_level_success_in_supported_json_contract(self):
        class Registration(Context):
            def register_tool(self, **definition):
                self.definition = definition
        ctx = Registration()
        cli.register_public_cli(ctx)
        with patch.object(cli, 'execute', return_value={'ok': True, 'success': True,
                                                       'response': {'outcome': 'failed'}}):
            result = ctx.definition['handler']({'argv': ['orchestration', 'worker-list']})
        self.assertIsInstance(result, str)
        self.assertTrue(json.loads(result)['success'])


if __name__ == '__main__':
    unittest.main()
