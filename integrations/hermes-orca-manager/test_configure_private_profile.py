"""Migration uses Hermes's nested plugin configuration without deleting user settings."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch


class ProfileMigrationTests(unittest.TestCase):
    def test_updates_the_actual_plugin_config_slot_and_preserves_other_settings(self):
        root = Path('/var/lib/hermes-manager/.hermes/profiles/orca-manager')
        configuration = {'plugins': {'entries': {'orca-manager': {
            'settings': {'memory_secret_file': '/old/memory-bridge.key', 'memory_port': 8789},
        }}}, 'model': {'provider': 'openai-codex'}, 'custom-setting': {'preserve': True}}
        config = ModuleType('hermes_cli.config')
        config.read_user_config_raw = Mock(return_value=configuration)
        config.atomic_config_replace = Mock()
        constants = ModuleType('hermes_constants')
        constants.get_hermes_home = lambda: root
        native_plugins = ModuleType('hermes_cli.plugins')
        native_plugins.PluginContext = type('PluginContext', (), {'get_config':
            lambda reader, key: configuration['plugins']['entries'][reader.plugin_id]['settings'].get(key)})
        with patch.dict(sys.modules, {'hermes_cli.config': config, 'hermes_constants': constants,
                                     'hermes_cli.plugins': native_plugins}):
            spec = importlib.util.spec_from_file_location('private_profile_fixture',
                Path(__file__).with_name('configure-private-profile.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.configure_private_profile()
        entry = configuration['plugins']['entries']['orca-manager']
        self.assertNotIn('memory_secret_file', entry)
        self.assertEqual(entry['settings']['memory_secret_file'], str(root / 'memory-bridge.key'))
        self.assertEqual(entry['settings']['memory_port'], 8789)
        self.assertEqual(configuration['custom-setting'], {'preserve': True})
        config.atomic_config_replace.assert_called_once_with(root / 'config.yaml', configuration)


if __name__ == '__main__':
    unittest.main()
