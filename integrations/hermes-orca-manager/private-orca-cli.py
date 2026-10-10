#!/usr/bin/python3 -I
"""Operator-installed public CLI launcher; never borrows an owner/pairing credential."""
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import sys
import tempfile

NODE = '/opt/hermes-manager/payload-66605471e9f0/tools/node-26.7.0-linux-arm64/bin/node'
CLI = '/opt/hermes-manager/orca-cli/index.cjs'
PROFILE = Path('/var/lib/hermes-manager/.hermes/profiles/orca-manager')
TRANSPORT = Path('/run/hermes-manager-transport')
OPERATIONS = frozenset({
    'placements', 'usage', 'resources', 'run-list', 'run-show', 'task-list', 'task-show',
    'worker-show', 'worker-read', 'run-create', 'task-create', 'worker-start', 'worker-guide',
    'question-answer', 'read', 'wait', 'snapshot', 'claim', 'renew', 'release', 'checkpoint',
    'check', 'ack',
})


def check_transport(path):
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != pwd.getpwnam('hermes-transport').pw_uid:
        raise ValueError('Unexpected private transport')


def fresh_metadata():
    path = TRANSPORT / 'metadata.sock'
    check_transport(path)
    check_transport(TRANSPORT / 'orca.sock')
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(12)
        connection.connect(str(path))
        chunks = bytearray()
        while True:
            chunk = connection.recv(4096)
            if not chunk:
                break
            chunks.extend(chunk)
            if len(chunks) > 16_384:
                raise ValueError('Private metadata exceeds its budget')
    value = json.loads(chunks)
    if (not isinstance(value, dict) or not isinstance(value.get('runtimeId'), str)
            or not 1 <= len(value['runtimeId']) <= 200
            or value.get('authToken') != 'manager-service-credential-required'
            or value.get('transports') != [{'kind': 'unix', 'endpoint': str(TRANSPORT / 'orca.sock')}]):
        raise ValueError('Unexpected bootstrap metadata')
    return value


def main(arguments):
    if os.getuid() != pwd.getpwnam('hermes-manager').pw_uid:
        raise ValueError('Only the private manager identity may invoke this launcher')
    if len(arguments) < 2 or arguments[0] != 'manager' or arguments[1] not in OPERATIONS:
        raise ValueError('Only non-administrative manager operations are permitted')
    if any(flag in arguments for flag in ('--environment', '--host', '--pairing-code')):
        raise ValueError('Private manager cannot select a paired owner connection')
    credential = PROFILE / 'orca-manager.credential'
    info = credential.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Manager credential must be a private caller-owned regular file')
    bootstrap = PROFILE / 'orca-bootstrap'
    bootstrap.mkdir(mode=0o700, exist_ok=True)
    info = bootstrap.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Unexpected bootstrap directory')
    fd, temporary = tempfile.mkstemp(prefix='.bootstrap-', dir=bootstrap)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(fresh_metadata(), stream)
        os.replace(temporary, bootstrap / 'orca-runtime.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('ORCA_') and key not in {'NODE_OPTIONS', 'NODE_PATH'}}
    environment.update({
        'ORCA_USER_DATA_PATH': str(bootstrap),
        'ORCA_MANAGER_CREDENTIAL_FILE': str(credential),
        'ORCA_BACKGROUND_LAUNCH': '1',
    })
    os.execve(NODE, [NODE, CLI, *arguments], environment)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, ValueError, KeyError):
        print('Private Orca manager transport unavailable; no owner fallback attempted', file=sys.stderr)
        sys.exit(69)
