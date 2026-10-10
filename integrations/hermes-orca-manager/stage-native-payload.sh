#!/bin/bash
# Publish PM's verified native payload; leave the active profile and services unchanged.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
source_payload=/home/developer/.local/share/hermes-manager-build/payload-66605471e9f0
native_payload=/opt/hermes-manager/payload-66605471e9f0
if [[ ! -d "$native_payload" ]]; then
  [[ -d "$source_payload" && ! -L "$source_payload" ]]
  /usr/bin/python3 - "$source_payload" <<'PY'
import json
from pathlib import Path
import sys
root = Path(sys.argv[1])
manifest = json.loads((root / "manifest.json").read_text())
assert manifest["target"] == "linux-arm64"
assert manifest["ref"] == "66605471e9f0b0832abbefaf625ce08e948ca540"
assert manifest["runtime"]["commands"]["hermes"] == "bin/hermes"
assert len(json.loads((root / "enabled-features.json").read_text())["extras"]) == 49
assert (root / "bin/hermes").is_file()
PY
  mv -T "$source_payload" "$native_payload"
  chown -R root:root "$native_payload"
  chmod -R a+rX,go-w "$native_payload"
fi
[[ ! -L "$native_payload" && $(stat -c '%U' "$native_payload") == root ]]
[[ -x "$native_payload/bin/hermes" ]]
printf 'STAGED: supported PM native payload, pinned ARM tools and 49 extras, root-owned.\n'
printf 'No credentials moved or manager/memory/user service stopped or started.\n'
