"""Upgrade an existing native plugin without replacing memory or event components."""
import ast
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import time
import yaml


ROOT = Path('/home/developer/.hermes')
SOURCE = Path(__file__).resolve().parent
PUBLIC_CLI = '/home/developer/.orca-relay/bin/orca'
POLICY = '''<!-- STANDARD ORCA DELEGATION -->
## Ordinary Orca delegation

Use the native orca_cli tool with an argv array, or the configured public relay CLI.
Read skills get orca-cli and skills get orchestration for its current commands.
Delegate to an existing agent with orchestration send; reconcile its message and
delivery receipt rather than treating acceptance as completion. No manager-owned
Run, adoption, service lease or replacement session is required. The scoped manager
credential is for event observation only. Do not use orca_dispatch_act or the private
manager launcher for ordinary delegation. A stale cached tool call must be corrected
to orca_cli, not reported as a missing owner authorization.
Outside an Orca terminal, mail uses this profile's configured hermes:<profile>
mailbox. It is a mail route, not a live terminal or worker lifecycle identity.

Company tasks go only to company Claude on notebook Work. Keep company credentials,
raw code/history and account access there; request the minimal owner-authorized
answer or scoped note/result through delegation. Preserve all other profile data,
memory, filesystem, project/account boundaries and existing owner gates/pauses.
The normal CLI does not authorize credentials discovery or security changes.
<!-- END STANDARD ORCA DELEGATION -->
'''


def replace_private(path, content):
    info = path.stat()
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.delegation-')
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
        os.chown(temporary, info.st_uid, info.st_gid)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def stage_plugin(link, modules, backup, label):
    active = link.resolve(strict=True)
    if not link.is_symlink() or not any(active.is_relative_to(parent) for parent in
            [Path('/opt/hermes-manager/candidates'), Path('/home/developer/.local/share')]):
        raise ValueError('Expected an existing operator-approved native plugin link')
    (backup / (label + '-plugin-target')).write_text(str(active))
    identity = hashlib.sha256(str(active).encode() + b''.join(modules.values())).hexdigest()[:20]
    candidate = Path('/opt/hermes-manager/candidates') / ('standard-cli-' + identity)
    if candidate.exists():
        raise ValueError('Candidate already exists; inspect its activation receipt before retrying')
    candidate.mkdir(mode=0o755)
    plugin = candidate / 'plugin'
    shutil.copytree(active, plugin, ignore=shutil.ignore_patterns('__pycache__'))
    for original in [active, *active.rglob('*')]:
        copied = plugin / original.relative_to(active)
        if copied.exists() and not original.is_symlink():
            info = original.stat()
            os.chown(copied, info.st_uid, info.st_gid)
    for name, data in modules.items():
        (plugin / name).write_bytes(data)
        (plugin / name).chmod(0o644)
    init = plugin / '__init__.py'
    text = init.read_text()
    if 'register_public_cli(ctx)' not in text:
        text = text.replace('def register(ctx):', 'def register(ctx):\n'
                            '    from .public_cli import register_public_cli\n'
                            '    register_public_cli(ctx)', 1)
    init.write_text(text)
    manifest = plugin / 'plugin.yaml'
    metadata = yaml.safe_load(manifest.read_text())
    if 'orca_cli' not in metadata['provides_tools']:
        metadata['provides_tools'].append('orca_cli')
    metadata['config_schema'].update({
        'use_standard_cli': {'type': 'bool', 'default': False},
        'orca_public_executable': {'type': 'str', 'default': ''},
        'orca_mailbox_address': {'type': 'str', 'default': ''}})
    manifest.write_text(yaml.safe_dump(metadata, sort_keys=False))
    for path in plugin.glob('*.py'):
        ast.parse(path.read_text(), filename=str(path))
    checksums = [f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(candidate)}'
                 for p in sorted(candidate.rglob('*'))
                 if p.is_file() and p.name != 'SHA256SUMS']
    (candidate / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    return link, plugin


def main():
    if os.geteuid() != 0 or not os.access(PUBLIC_CLI, os.X_OK):
        raise ValueError('Run as the operator after verifying the public relay CLI')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    backup = Path('/var/backups') / ('hermes-standard-delegation-' + stamp)
    backup.mkdir(mode=0o700)
    modules = {name: (SOURCE / name).read_bytes()
               for name in ['public_cli.py', 'interactive_tools.py']}
    links = [(ROOT / 'plugins/orca-manager', 'global')]
    links += [(ROOT / 'profiles' / name / 'plugins/orca-manager', name)
              for name in ['work', 'coding', 'coordinator']]
    staged = [stage_plugin(link, modules, backup, label) for link, label in links]
    for name in ['work', 'coding', 'coordinator']:
        home = ROOT / 'profiles' / name
        for filename in ['config.yaml', 'SOUL.md']:
            shutil.copy2(home / filename, backup / (name + '-' + filename))
        config = yaml.safe_load((home / 'config.yaml').read_text())
        settings = config['plugins']['entries']['orca-manager']['settings']
        settings.update(use_standard_cli=True, orca_public_executable=PUBLIC_CLI,
                        orca_mailbox_address='hermes:' + name)
        replace_private(home / 'config.yaml', yaml.safe_dump(config, sort_keys=False))
        soul = (home / 'SOUL.md').read_text()
        start, end = '<!-- STANDARD ORCA DELEGATION -->', '<!-- END STANDARD ORCA DELEGATION -->'
        if start in soul and end in soul:
            before, remainder = soul.split(start, 1)
            soul = before + remainder.split(end, 1)[1].lstrip('\n')
        replace_private(home / 'SOUL.md', POLICY + '\n' + soul)
    for link, plugin in staged:
        temporary = link.with_name('.orca-manager-standard')
        temporary.symlink_to(plugin)
        os.replace(temporary, link)
        print('Activated:', link, '->', plugin)
    print('Preserved memory/event code and profile credentials. Backup:', backup)
    print('Hot-reload Work and Coding through the existing gateway control socket.')


if __name__ == '__main__':
    main()
