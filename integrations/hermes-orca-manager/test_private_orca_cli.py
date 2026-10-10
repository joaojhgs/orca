"""Private launcher contracts: service-only routing and owner/admin refusal."""
import importlib.util
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('private_orca_cli', Path(__file__).with_name('private-orca-cli.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class PrivateLauncherTests(unittest.TestCase):
    def test_owner_and_administration_commands_are_refused_before_credential_access(self):
        with patch.object(launcher.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())):
            for arguments in (['terminal', 'create'], ['manager', 'authorize'], ['manager', 'revoke'],
                              ['manager', 'read', '--pairing-code', 'owner-target']):
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    launcher.main(arguments)

    def test_refreshes_bootstrap_without_owner_token_and_overrides_ambient_routing(self):
        with TemporaryDirectory(prefix='hermes-private-cli-test-') as directory:
            profile = Path(directory)
            credential = profile / 'orca-manager.credential'
            credential.write_text('fake-service-key-for-fixture-only')
            credential.chmod(0o600)
            metadata = {
                'runtimeId': 'latest-controller-runtime', 'pid': 0, 'startedAt': 100,
                'authToken': 'manager-service-credential-required',
                'transports': [{'kind': 'unix', 'endpoint': '/run/hermes-manager-transport/orca.sock'}],
            }
            with patch.object(launcher, 'PROFILE', profile), \
                    patch.object(launcher.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())), \
                    patch.object(launcher, 'fresh_metadata', return_value=metadata), \
                    patch.object(launcher.os, 'execve') as execute, \
                    patch.dict(os.environ, {'ORCA_MANAGER_TOKEN': 'fixture-owner-not-real',
                                            'ORCA_ENVIRONMENT': 'paired-owner', 'NODE_OPTIONS': '--inspect'}):
                launcher.main(['manager', 'read', '--json'])
            executable, arguments, environment = execute.call_args.args
            self.assertEqual(executable, launcher.NODE)
            self.assertEqual(arguments[1], launcher.CLI)
            self.assertNotIn('ORCA_MANAGER_TOKEN', environment)
            self.assertNotIn('ORCA_ENVIRONMENT', environment)
            self.assertNotIn('NODE_OPTIONS', environment)
            self.assertEqual(environment['ORCA_MANAGER_CREDENTIAL_FILE'], str(credential))
            published = profile / 'orca-bootstrap/orca-runtime.json'
            self.assertEqual(json.loads(published.read_text()), metadata)
            self.assertEqual(published.stat().st_mode & 0o777, 0o600)

    def test_public_or_symlinked_credentials_cannot_select_an_owner_fallback(self):
        with TemporaryDirectory(prefix='hermes-private-cli-test-') as directory:
            profile = Path(directory)
            credential = profile / 'orca-manager.credential'
            credential.write_text('fake-key')
            credential.chmod(0o644)
            with patch.object(launcher, 'PROFILE', profile), \
                    patch.object(launcher.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid())), \
                    patch.object(launcher.os, 'execve') as execute:
                with self.assertRaises(ValueError):
                    launcher.main(['manager', 'read'])
                credential.unlink()
                credential.symlink_to(profile / 'absent')
                with self.assertRaises(ValueError):
                    launcher.main(['manager', 'read'])
                execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
