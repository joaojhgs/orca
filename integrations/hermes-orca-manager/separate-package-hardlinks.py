#!/usr/bin/python3
"""Detach package-cache inodes before changing ownership; never chown a shared file."""
import argparse
import os
from pathlib import Path
import pwd
import shutil
import stat
import tempfile


def separate_inode(path, uid, gid):
    if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('Only a regular package file may be rematerialized')
    fd, temporary = tempfile.mkstemp(prefix='.ownership-', dir=path.parent)
    os.close(fd)
    try:
        shutil.copy2(path, temporary)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


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
