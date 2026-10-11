#!/usr/bin/python3
"""Explicit owner-approved migration of the original worker deployment, not an auto-updater."""
import argparse
import copy
import datetime
import json
import os
from pathlib import Path
import pwd
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile

import yaml

ROOT = Path('/home/developer/.hermes')
SOURCE = Path('/var/lib/hermes-manager/.hermes/profiles/orca-manager')
DESTINATION = ROOT / 'profiles/orca-manager'
PAYLOAD = Path('/opt/hermes-manager/payload-66605471e9f0')


def write_private(path, value, uid, gid):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.interactive-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def configure(config):
    config = copy.deepcopy(config)
    plugins = config.setdefault('plugins', {})
    plugins['enabled'] = list(dict.fromkeys([*plugins.get('enabled', []), 'hindsight', 'orca-manager', 'orca-status']))
    plugins['disabled'] = [name for name in plugins.get('disabled', []) if name not in plugins['enabled']]
    settings = plugins.setdefault('entries', {}).setdefault('orca-manager', {}).setdefault('settings', {})
    settings.update({
        'memory_secret_file': str(DESTINATION / 'memory-bridge.key'),
        'hermes_executable': str(PAYLOAD / 'bin/hermes'),
        'orca_executable': '/usr/local/libexec/hermes-orca-cli',
        'orca_credential_file': str(DESTINATION / 'orca-manager.credential'),
        'enable_event_tools': True,
    })
    return config


def migrate(candidate):
    account = pwd.getpwnam('developer')
    if os.getuid() != 0 or account.pw_dir != '/home/developer':
        raise ValueError('This migration requires the reviewed worker and root operator')
    if not SOURCE.is_dir() or SOURCE.is_symlink() or DESTINATION.exists() or (ROOT / 'auth.json').exists():
        raise ValueError('Refusing an existing destination/login or unexpected source')
    if not candidate.is_dir() or not str(candidate).startswith('/opt/hermes-manager/candidates/'):
        raise ValueError('A staged immutable integration candidate is required')
    for name in ('event_tools.py', 'private-orca-cli.py', '__init__.py', 'plugin.yaml'):
        info = (candidate / 'plugin' / name).lstat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Candidate must be operator-owned and not writable by agents')
    tui = ROOT / 'hermes-agent/ui-tui/dist/entry.js'
    if not tui.is_file() or not (PAYLOAD / 'bin/hermes').is_file():
        raise ValueError('Native Hermes and its existing TUI must be installed before migration')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = Path(tempfile.mkdtemp(prefix='hermes-interactive-' + stamp + '-', dir='/var/backups'))
    os.chmod(backup, 0o700)
    # Stop only the custom adapter and auth-using bridge. Hindsight and all user workers stay up.
    subprocess.run(['systemctl', 'stop', 'hermes-orca-manager.service', 'hermes-memory-private-bridge.service'], check=True)
    with tarfile.open(backup / 'custody-before.tar.gz', 'w:gz') as archive:
        for target in [SOURCE, ROOT / 'config.yaml', ROOT / 'auth.json', ROOT / 'hindsight',
                       Path('/home/developer/.local/bin/hermes'), Path('/usr/local/libexec/hermes-orca-cli'),
                       Path('/usr/local/bin/hermes-manager-console'), Path('/etc/sudoers.d/hermes-manager-console'),
                       Path('/etc/tmpfiles.d/hermes-manager-transport.conf')]:
            if target.exists() or target.is_symlink():
                archive.add(target, arcname=str(target).lstrip('/'), recursive=True)
    private_config = yaml.safe_load((SOURCE / 'config.yaml').read_text())
    default_config = yaml.safe_load((ROOT / 'config.yaml').read_text()) or {}
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(SOURCE), str(DESTINATION))
    for directory, directories, files in os.walk(DESTINATION, followlinks=False):
        os.chown(directory, account.pw_uid, account.pw_gid)
        for name in [*directories, *files]:
            os.chown(Path(directory) / name, account.pw_uid, account.pw_gid, follow_symlinks=False)
    os.chown(DESTINATION.parent, account.pw_uid, account.pw_gid)
    # One live OAuth store. Named profiles borrow it via native Hermes's locked root fallback.
    os.replace(DESTINATION / 'auth.json', ROOT / 'auth.json')
    os.chmod(ROOT / 'auth.json', 0o600)
    default_config.update({key: copy.deepcopy(private_config[key]) for key in ('model', 'auth', 'memory')})
    private_config.get('agent', {}).pop('max_turns', None)
    for path, config in [(ROOT / 'config.yaml', configure(default_config)),
                         (DESTINATION / 'config.yaml', configure(private_config))]:
        write_private(path, yaml.safe_dump(config, sort_keys=False), account.pw_uid, account.pw_gid)
    if (DESTINATION / 'SOUL.md').exists():
        os.replace(DESTINATION / 'SOUL.md', DESTINATION / 'ORCA_MANAGER_LEGACY_SOUL.md')
    for name, target in [('hindsight', Path('/opt/hermes-manager/plugins/hindsight')),
                         ('orca-manager', candidate / 'plugin'), ('orca-status', ROOT / 'plugins/orca-status')]:
        for plugins in [ROOT / 'plugins', DESTINATION / 'plugins']:
            plugins.mkdir(exist_ok=True)
            os.chown(plugins, account.pw_uid, account.pw_gid)
            path = plugins / name
            if path == target:
                continue
            if path.is_symlink():
                path.unlink()
            elif path.exists():
                raise ValueError('Refusing to overwrite an existing plugin directory')
            path.symlink_to(target)
            os.chown(path, account.pw_uid, account.pw_gid, follow_symlinks=False)
    memory_config = (DESTINATION / 'hindsight/config.json').read_text()
    write_private(ROOT / 'hindsight/config.json', memory_config, account.pw_uid, account.pw_gid)
    os.chown(ROOT / 'hindsight', account.pw_uid, account.pw_gid)
    routing = Path('/etc/hermes-manager/interactive.json')
    write_private(routing, json.dumps({'user': 'developer', 'profile': str(DESTINATION)}), 0, 0)
    os.chmod(routing, 0o644)
    shutil.copyfile(candidate / 'plugin/private-orca-cli.py', '/usr/local/libexec/hermes-orca-cli')
    os.chmod('/usr/local/libexec/hermes-orca-cli', 0o755)
    # Existing relay PTYs already have the developer group; no reconnect or broad group grant.
    transport_config = Path('/etc/tmpfiles.d/hermes-manager-transport.conf')
    write_private(transport_config, 'd /run/hermes-manager-transport 2750 hermes-transport developer -\n', 0, 0)
    subprocess.run(['systemd-tmpfiles', '--create', str(transport_config)], check=True)
    for name in ('orca.sock', 'metadata.sock'):
        os.chown(Path('/run/hermes-manager-transport') / name, -1, account.pw_gid)
    launcher = ('#!/bin/sh\nexport HERMES_TUI_DIR=/home/developer/.hermes/hermes-agent/ui-tui\n'
                f'export HERMES_NODE={PAYLOAD}/tools/node-26.7.0-linux-arm64/bin/node\n'
                f'exec {PAYLOAD}/bin/hermes "$@"\n')
    write_private(Path('/home/developer/.local/bin/hermes'), launcher, account.pw_uid, account.pw_gid)
    os.chmod('/home/developer/.local/bin/hermes', 0o755)
    override = Path('/etc/systemd/system/hermes-memory-private-bridge.service.d/interactive.conf')
    write_private(override, ('[Service]\nUser=developer\nGroup=developer\n'
                            'WorkingDirectory=/home/developer\nEnvironment=HOME=/home/developer\n'
                            'Environment=HERMES_HOME=/home/developer/.hermes\n'
                            'Environment=XDG_CACHE_HOME=/home/developer/.cache\nProtectHome=read-only\n'
                            'ReadWritePaths=\nReadWritePaths=/home/developer/.hermes /home/developer/.cache\n'), 0, 0)
    for old in [Path('/etc/sudoers.d/hermes-manager-console'), Path('/usr/local/bin/hermes-manager-console')]:
        if old.exists():
            shutil.move(str(old), str(backup / ('retired-' + old.name)))
    with sqlite3.connect(DESTINATION / 'state.db') as database:
        if database.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Migrated session database did not validate')
    for path in DESTINATION.glob('state.db*'):
        if path.is_file() and not path.is_symlink():
            os.chown(path, account.pw_uid, account.pw_gid)
    subprocess.run(['systemctl', 'disable', 'hermes-orca-manager.service'], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'start', 'hermes-memory-private-bridge.service'], check=True)
    receipt = {'profile': str(DESTINATION), 'oauthStore': str(ROOT / 'auth.json'), 'backup': str(backup),
               'customAdapter': 'disabled', 'memoryDatabase': 'unchanged', 'pluginCandidate': str(candidate)}
    write_private(backup / 'migration.json', json.dumps(receipt, indent=2), 0, 0)
    print(json.dumps(receipt))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    args = parser.parse_args()
    migrate(args.candidate)
