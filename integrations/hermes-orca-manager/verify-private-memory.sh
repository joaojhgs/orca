#!/bin/bash
# Exercise retain/recall/reflect in the same OS sandbox as the native manager.
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
systemd-run --unit="hermes-manager-private-memory-check-$(date +%s)" --collect --wait --pipe \
  "${properties[@]}" /opt/hermes-manager/payload-66605471e9f0/bin/hermes \
  -p orca-manager orca-manager memory-test
