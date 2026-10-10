"""Operator-only path migration through Hermes's supported config writer."""
from pathlib import Path
from types import SimpleNamespace

from hermes_cli.config import atomic_config_replace, read_user_config_raw
from hermes_cli.plugins import PluginContext
from hermes_constants import get_hermes_home


def configure_private_profile():
    profile = get_hermes_home()
    if profile != Path('/var/lib/hermes-manager/.hermes/profiles/orca-manager'):
        raise ValueError('Refusing to change any other Hermes profile')
    config_path = profile / 'config.yaml'
    config = read_user_config_raw(config_path)
    plugins = config.setdefault('plugins', {})
    entry = plugins.setdefault('entries', {}).setdefault('orca-manager', {})
    values = {
        'memory_secret_file': str(profile / 'memory-bridge.key'),
        'hermes_executable': '/opt/hermes-manager/payload-66605471e9f0/bin/hermes',
        'orca_executable': '/usr/local/libexec/hermes-orca-cli',
        'orca_credential_file': str(profile / 'orca-manager.credential'),
    }
    entry.setdefault('settings', {}).update(values)
    stray = plugins.get('settings', {}).get('orca-manager')
    if stray is not None:
        if stray != {'config': values}:
            raise ValueError('Unexpected unregistered plugin setting requires operator review')
        del plugins['settings']['orca-manager']
        if not plugins['settings']:
            del plugins['settings']
    atomic_config_replace(config_path, config)
    reader = SimpleNamespace(plugin_id='orca-manager', _segments=lambda key: (key,))
    for key, value in values.items():
        if PluginContext.get_config(reader, key) != value:
            raise ValueError('Native plugin reader did not confirm the migrated setting')
    print('Private profile paths configured; no login or manager authority activated')


if __name__ == '__main__':
    configure_private_profile()
