"""Operator acceptance probe: native provider turn, without Orca or shell tools."""
import json
import os
import subprocess

from .decision_runner import parse_native_result


def verify_native_turn():
    if os.environ.get("HERMES_HOME") != "/var/lib/hermes-manager/.hermes":
        raise RuntimeError("Probe must run in the private manager sandbox")
    expected = "ORCA_MANAGER_NATIVE_READY"
    executable = "/opt/hermes-manager/payload-66605471e9f0/bin/hermes"
    result = subprocess.run(
        [executable, "-p", "orca-manager", "chat", "--query-file", "-",
         "--format", "stream-json", "--toolsets", "memory,session_search", "--no-restore-cwd"],
        input=("This is an operator setup check, not a project objective. "
               "Do not use any tools, retrieve private information or change files. "
               "Reply exactly " + expected + ".").encode(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180, check=False,
    )
    record, session = parse_native_result(result.stdout, result.returncode)
    matched = record["text"].strip() == expected
    print(json.dumps({"nativeResultConfirmed": True, "expectedReply": matched,
                      "sessionConfirmed": bool(session), "returncode": result.returncode}))
    if not matched:
        raise RuntimeError("Native setup probe did not return the expected reply")


if __name__ == "__main__":
    try:
        verify_native_turn()
    except (RuntimeError, subprocess.TimeoutExpired):
        # Never copy native provider diagnostics or private prompt context into service logs.
        print(json.dumps({"nativeResultConfirmed": False}))
        raise SystemExit(1)
