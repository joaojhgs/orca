#!/usr/bin/python3
"""Detach package-cache inodes before changing ownership; never chown a shared file."""
import argparse
import os
from pathlib import Path
import pwd
import shutil
import stat
import secrets


def separate_inode(path, uid, gid):
    path = Path(path).absolute()
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    temporary = '.ownership-' + secrets.token_hex(12)
    source = destination = None
    try:
        # Anchor every ancestor. Active agents cannot redirect a root operation through a symlink.
        for part in path.parent.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        try:
            source = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        except OSError as error:
            raise ValueError('Only a regular package file may be rematerialized') from error
        info = os.fstat(source)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('Only a regular package file may be rematerialized')
        destination = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                              0o600, dir_fd=directory)
        with os.fdopen(os.dup(source), 'rb') as reader, os.fdopen(os.dup(destination), 'wb') as writer:
            shutil.copyfileobj(reader, writer)
        os.fchmod(destination, stat.S_IMODE(info.st_mode))
        os.fchown(destination, uid, gid)
        os.utime(destination, ns=(info.st_atime_ns, info.st_mtime_ns))
        os.fsync(destination)
        os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
    finally:
        for descriptor in (source, destination):
            if descriptor is not None:
                os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def main(mode):
    if os.getuid() != 0:
        raise ValueError('Only the operator may repair package ownership')
    developer = pwd.getpwnam('developer')
    root = Path('/home/developer/.hermes/cache/uv') if mode == 'cache' else Path('/opt/hermes-manager/payload-66605471e9f0')
    if root.resolve() != root or not root.is_dir():
        raise ValueError('Unexpected package root; no symlink or alternate disk accepted')
    count = 0
    for directory, children, files in os.walk(root, followlinks=False):
        children[:] = [name for name in children if not (Path(directory) / name).is_symlink()]
        for name in files:
            path = Path(directory) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                continue
            needs_copy = info.st_uid == 0 if mode == 'cache' else info.st_nlink > 1
            if needs_copy:
                uid, gid = (developer.pw_uid, developer.pw_gid) if mode == 'cache' else (info.st_uid, info.st_gid)
                separate_inode(path, uid, gid)
                count += 1
    print(f'Rematerialized {count} package files; bytes/modes preserved, other hardlinks untouched.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['cache', 'payload'])
    main(parser.parse_args().mode)
