"""The operator console cannot choose a command, unit, identity or privileged environment."""
import hashlib
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('manager_console', Path(__file__).with_name('manager-console.py'))
console = importlib.util.module_from_spec(spec)
spec.loader.exec_module(console)


class ManagerConsoleTests(unittest.TestCase):
    def setUp(self):
        self.unit = b'reviewed-unit-fixture'
        self.identities = lambda name: SimpleNamespace(pw_uid={'developer': 1002, 'hermes-manager': 996}[name])
        self.properties = ('FragmentPath=/etc/systemd/system/hermes-orca-manager.service\n'
                           'DropInPaths=\nNeedDaemonReload=no\nUser=hermes-manager\nGroup=hermes-manager\n')

    def prerequisite(self, path, owner, private=False):
        if path == console.UNIT_PATH:
            self.assertEqual(owner, 0)
            return self.unit
        if path == console.DIGEST_PATH:
            self.assertEqual(owner, 0)
            return hashlib.sha256(self.unit).hexdigest().encode()
        self.assertEqual(path, console.CREDENTIAL)
        self.assertEqual(owner, 996)
        self.assertTrue(private)
        return b'fixture-private-grant'

    def test_refuses_arguments_and_non_operator_identity_before_any_service_action(self):
        with patch.object(console.pwd, 'getpwnam', side_effect=self.identities), \
                patch.object(console.os, 'geteuid', return_value=0), \
                patch.object(console, 'run_systemctl') as service:
            for environment, arguments in (({'SUDO_USER': 'developer', 'SUDO_UID': '1002'}, ['stop']),
                                           ({'SUDO_USER': 'hermes-manager', 'SUDO_UID': '996'}, []),
                                           ({'SUDO_USER': 'developer', 'SUDO_UID': '0'}, []), ({}, [])):
                with patch.dict(os.environ, environment, clear=True), self.assertRaises(ValueError):
                    console.main(arguments)
            service.assert_not_called()

    def test_starts_only_fixed_unit_then_follows_only_its_logs_with_clean_environment(self):
        with patch.object(console.pwd, 'getpwnam', side_effect=self.identities), \
                patch.object(console.os, 'geteuid', return_value=0), \
                patch.dict(os.environ, {'SUDO_USER': 'developer', 'SUDO_UID': '1002',
                                        'SYSTEMD_PAGER': '/bin/sh', 'PYTHONPATH': '/tmp/untrusted'}, clear=True), \
                patch.object(console, 'protected_file', side_effect=self.prerequisite), \
                patch.object(console, 'run_systemctl', side_effect=[self.properties, '', '']) as service, \
                patch.object(console.os, 'execve') as execute:
            console.main([])
        self.assertEqual(service.call_args_list[1].args, ('enable', '--now', console.UNIT))
        self.assertEqual(service.call_args_list[2].args, ('is-active', '--quiet', console.UNIT))
        executable, argv, environment = execute.call_args.args
        self.assertEqual(executable, '/usr/bin/journalctl')
        self.assertIn('--unit=hermes-orca-manager.service', argv)
        self.assertIn('--no-pager', argv)
        self.assertEqual(environment['SYSTEMD_PAGER'], '')
        self.assertNotIn('PYTHONPATH', environment)

    def test_modified_or_stale_unit_does_not_start(self):
        for properties in (self.properties.replace('DropInPaths=', 'DropInPaths=/tmp/override'),
                           self.properties.replace('NeedDaemonReload=no', 'NeedDaemonReload=yes'),
                           self.properties.replace('User=hermes-manager', 'User=root')):
            with patch.object(console.pwd, 'getpwnam', side_effect=self.identities), \
                    patch.object(console.os, 'geteuid', return_value=0), \
                    patch.dict(os.environ, {'SUDO_USER': 'developer', 'SUDO_UID': '1002'}, clear=True), \
                    patch.object(console, 'protected_file', side_effect=self.prerequisite), \
                    patch.object(console, 'run_systemctl', return_value=properties) as service:
                with self.assertRaises(ValueError):
                    console.main([])
                self.assertEqual(service.call_count, 1)

    def test_subprocess_has_fixed_binary_timeout_no_shell_and_no_caller_environment(self):
        with patch.object(console.subprocess, 'run', return_value=SimpleNamespace(stdout='active')) as run:
            console.run_systemctl('start', console.UNIT)
        args, kwargs = run.call_args
        self.assertEqual(args[0], ['/usr/bin/systemctl', 'start', console.UNIT])
        self.assertTrue(kwargs['check'])
        self.assertEqual(kwargs['timeout'], 30)
        self.assertEqual(kwargs['env'], console.ENVIRONMENT)
        self.assertNotIn('shell', kwargs)

    def test_file_checks_reject_symlinks_wrong_owners_and_broad_credentials(self):
        with TemporaryDirectory(prefix='manager-console-test-') as directory:
            path = Path(directory) / 'credential'
            path.write_bytes(b'fixture-grant')
            path.chmod(0o600)
            self.assertEqual(console.protected_file(path, os.getuid(), private=True), b'fixture-grant')
            with self.assertRaises(ValueError):
                console.protected_file(path, os.getuid() + 1, private=True)
            path.chmod(0o640)
            with self.assertRaises(ValueError):
                console.protected_file(path, os.getuid(), private=True)
            link = Path(directory) / 'link'
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                console.protected_file(link, os.getuid())

    def test_modified_unit_digest_is_refused_before_service_access(self):
        def changed(path, owner, private=False):
            return b'not-the-reviewed-digest' if path == console.DIGEST_PATH else self.prerequisite(path, owner, private)
        with patch.object(console.pwd, 'getpwnam', side_effect=self.identities), \
                patch.object(console.os, 'geteuid', return_value=0), \
                patch.dict(os.environ, {'SUDO_USER': 'developer', 'SUDO_UID': '1002'}, clear=True), \
                patch.object(console, 'protected_file', side_effect=changed), \
                patch.object(console, 'run_systemctl') as service:
            with self.assertRaises(ValueError):
                console.main([])
            service.assert_not_called()


if __name__ == '__main__':
    unittest.main()
