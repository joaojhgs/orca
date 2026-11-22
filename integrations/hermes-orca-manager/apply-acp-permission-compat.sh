#!/usr/bin/env bash
set -euo pipefail
repo=${1:?Usage: apply-acp-permission-compat.sh /path/to/hermes-agent [Hermes cache directory]}
cache=${2:-}
patch_file=$(dirname "$(readlink -f "$0")")/acp-permission-config.patch
[[ -f "$repo/acp_adapter/server.py" && -f "$patch_file" ]]
if patch --dry-run --reverse --silent -d "$repo" -p1 < "$patch_file"; then
  echo 'Hermes ACP policy compatibility is already installed.'
  exit 0
fi
patch --dry-run -d "$repo" -p1 < "$patch_file"
backup=/var/backups/hermes-acp-interface/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup"
cp -a "$repo/acp_adapter/server.py" "$backup/server.py"
patch -d "$repo" -p1 < "$patch_file"
python3 - "$repo" "$cache" <<'PY'
import pathlib, sys
module = pathlib.Path(sys.argv[1]).resolve() / 'acp_adapter'
roots = [module / '__pycache__']
if sys.argv[2]:
    roots.append(pathlib.Path(sys.argv[2]) / module.relative_to('/'))
for root in roots:
    for compiled in root.glob('server.cpython-*.pyc'):
        compiled.unlink()
PY
printf 'ACP adapter updated; original: %s/server.py\nNo gateway restart is needed.\n' "$backup"
