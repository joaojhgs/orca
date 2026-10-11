#!/usr/bin/python3 -I
"""Fixed operator console: start one reviewed unit and follow only its logs."""
import hashlib
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys

UNIT = 'hermes-orca-manager.service'
UNIT_PATH = Path('/etc/systemd/system') / UNIT
DIGEST_PATH = Path('/opt/hermes-manager/console/unit.sha256')
CREDENTIAL = Path('/var/lib/hermes-manager/.hermes/profiles/orca-manager/orca-manager.credential')
ENVIRONMENT = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8',
               'LC_ALL': 'C.UTF-8', 'SYSTEMD_PAGER': '', 'SYSTEMD_COLORS': '0'}


def protected_file(path, owner, private=False):
    info = path.lstat()
    forbidden = 0o077 if private else 0o022
    if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_mode & forbidden:
        raise ValueError('Untrusted console prerequisite')
    return path.read_bytes()


def run_systemctl(*arguments):
    return subprocess.run(['/usr/bin/systemctl', *arguments], check=True, capture_output=True,
                          text=True, timeout=30, cwd='/', env=ENVIRONMENT, close_fds=True).stdout


def main(arguments):
    developer = pwd.getpwnam('developer')
    manager = pwd.getpwnam('hermes-manager')
    if (arguments or os.geteuid() != 0 or os.environ.get('SUDO_USER') != 'developer'
            or os.environ.get('SUDO_UID') != str(developer.pw_uid)):
        raise ValueError('Only the fixed developer console is permitted')
    unit = protected_file(UNIT_PATH, 0)
    expected = protected_file(DIGEST_PATH, 0).decode('ascii').strip()
    if hashlib.sha256(unit).hexdigest() != expected:
        raise ValueError('Reviewed manager unit has changed')
    if not protected_file(CREDENTIAL, manager.pw_uid, private=True).strip():
        raise ValueError('Manager credential is not installed')
    properties = run_systemctl('show', UNIT, '--property=FragmentPath', '--property=DropInPaths',
                              '--property=NeedDaemonReload', '--property=User', '--property=Group')
    values = dict(line.split('=', 1) for line in properties.splitlines() if '=' in line)
    if values != {'FragmentPath': str(UNIT_PATH), 'DropInPaths': '', 'NeedDaemonReload': 'no',
                  'User': 'hermes-manager', 'Group': 'hermes-manager'}:
        raise ValueError('Loaded manager unit differs from the reviewed service')
    run_systemctl('enable', '--now', UNIT)
    run_systemctl('is-active', '--quiet', UNIT)
    print('Hermes manager is running on the coding worker. Closing this console does not stop it.',
          flush=True)
    os.execve('/usr/bin/journalctl', ['/usr/bin/journalctl', '--unit=' + UNIT, '--follow',
                                    '--lines=20', '--output=cat', '--no-pager'], ENVIRONMENT)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        print('Manager console refused: verify the reviewed unit, private grant and service readiness.',
              file=sys.stderr)
        sys.exit(69)
