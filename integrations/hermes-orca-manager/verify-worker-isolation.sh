#!/bin/bash
# Reuse the production sandbox properties, without starting the event consumer or a model.
set -euo pipefail
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
properties=()
service=false
while IFS= read -r line; do
  case "$line" in
    '[Service]') service=true; continue ;;
    '['*) service=false; continue ;;
  esac
  $service || continue
  case "$line" in
    Environment=*) properties+=("--setenv=${line#Environment=}") ;;
    Type=*|ExecStart=*|Restart=*|RestartSec=*|TimeoutStopSec=*|'') ;;
    *) properties+=(-p "$line") ;;
  esac
done < "$directory/hermes-orca-manager.service"
systemd-run --unit="hermes-manager-bootstrap-check-$(date +%s)" --collect --wait --pipe \
  "${properties[@]}" /home/developer/.hermes/hermes-agent/.hermes/bin/hermes --help
systemd-run --unit="hermes-manager-boundary-check-$(date +%s)" --collect --wait --pipe \
  "${properties[@]}" \
  -p "BindReadOnlyPaths=$directory/verify-worker-isolation.py:/var/lib/hermes-manager/check-boundaries.py" \
  /usr/bin/python3 /var/lib/hermes-manager/check-boundaries.py
