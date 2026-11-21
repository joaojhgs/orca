"""Negative checks inside the staged systemd sandbox; no credentials or model calls."""
import os
from pathlib import Path
import subprocess
import socket

assert os.geteuid() != 0
assert os.geteuid() == __import__("pwd").getpwnam("hermes-manager").pw_uid
for target in (
    "/home/developer/.ssh", "/home/developer/.codex/auth.json",
    "/home/developer/projects", "/root/.ssh", "/run/user/1002",
    "/run/docker.sock", "/var/lib/orca-control",
):
    assert not os.access(target, os.R_OK), f"Unexpected readable host path: {target}"
    print(f"PASS: protected {target}")
source = Path("/opt/hermes-manager/payload-66605471e9f0/hermes-agent/hermes_cli/main.py")
assert source.is_file()
assert not os.access(source, os.W_OK)
assert not os.access(source.parent, os.W_OK)
assert not os.access("/etc/sudoers", os.W_OK)
assert not os.access("/etc/systemd/system", os.W_OK)
assert subprocess.run(["/usr/bin/sudo", "-n", "true"], capture_output=True).returncode != 0
status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
assert int(status["NoNewPrivs"].strip()) == 1
assert int(status["CapEff"].strip(), 16) == 0
assert int(status["CapBnd"].strip(), 16) == 0
print("PASS: runtime/configuration are not writable; sudo and capabilities unavailable")
for address in ("127.0.0.1", "10.0.1.24", "169.254.169.254", "100.64.0.3"):
    with socket.socket() as connection:
        connection.settimeout(2)
        assert connection.connect_ex((address, 22 if address != "169.254.169.254" else 80)) != 0, \
            f"Unexpected network access: {address}"
    print(f"PASS: restricted network target {address}")
private = Path("/var/lib/hermes-manager/.hermes/isolation-check")
with private.open("x") as stream:
    stream.write("private manager state only\n")
assert private.stat().st_uid == os.geteuid()
private.unlink()
print("PASS: private manager state remains writable")
