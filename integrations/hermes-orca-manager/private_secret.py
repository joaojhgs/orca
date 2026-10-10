"""Private independent service keys, never OAuth credential resolution."""
import os
import stat


def read_private_secret(path):
    if not path:
        raise ValueError("Configure a private service-key file before starting the memory bridge")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024:
            raise ValueError("Memory secret must be a small regular file")
        if os.name != "nt" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
            raise ValueError("Memory secret must be private and caller-owned")
        value = os.read(fd, 1025).decode("utf-8").strip()
        if not 32 <= len(value) <= 256 or not value.isascii() or any(c.isspace() for c in value):
            raise ValueError("Invalid memory bridge secret")
        return value
    finally:
        os.close(fd)
