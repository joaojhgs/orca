#!/bin/bash
# Overlay candidate code for isolated checks; leave installed plugins and services unchanged.
set -euo pipefail
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
unit_file=${1:?Pass the reviewed staged production manager unit}
[[ -f $unit_file ]]
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
done < "$unit_file"
properties+=(-p "BindReadOnlyPaths=$directory:/opt/hermes-manager/plugins/orca-manager")
systemd-run --unit="hermes-manager-decision-tests-$(date +%s)" --collect --wait --pipe \
  "${properties[@]}" /opt/hermes-manager/payload-66605471e9f0/venv/bin/python -m unittest discover \
  -s /opt/hermes-manager/plugins/orca-manager -p 'test_*.py' \
  -k AdapterTests -k ToolTests -k ObjectiveDecisionTests -k NativeDecisionTests -k ClientTests -k FailureTests
systemd-run --unit="hermes-manager-native-plugin-check-$(date +%s)" --collect --wait --pipe \
  "${properties[@]}" /opt/hermes-manager/payload-66605471e9f0/bin/hermes \
  -p orca-manager orca-manager --help
