import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('interactive_profile', Path(__file__).with_name('migrate-interactive-profile.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class InteractiveProfileTests(unittest.TestCase):
    def test_event_configuration_preserves_native_tools_and_existing_settings(self):
        source = {'agent': {'max_turns': 90}, 'terminal': {'backend': 'local'},
                  'plugins': {'enabled': ['existing'], 'disabled': ['orca-manager', 'other']}}
        result = migration.configure(source)
        self.assertEqual(result['agent'], source['agent'])
        self.assertEqual(result['terminal'], source['terminal'])
        self.assertIn('existing', result['plugins']['enabled'])
        self.assertIn('orca-manager', result['plugins']['enabled'])
        self.assertEqual(result['plugins']['disabled'], ['other'])
        self.assertTrue(result['plugins']['entries']['orca-manager']['settings']['enable_event_tools'])
        self.assertEqual(source['plugins']['disabled'], ['orca-manager', 'other'])
        self.assertNotIn('entries', source['plugins'])


if __name__ == '__main__':
    unittest.main()
