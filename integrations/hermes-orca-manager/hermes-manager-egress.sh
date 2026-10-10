#!/bin/bash
# Do not reload or flush any other host firewall table.
set -euo pipefail
[[ $EUID == 0 ]]
policy_input() {
  if /usr/sbin/nft list table inet hermes_manager_guard >/dev/null 2>&1; then
    printf 'delete table inet hermes_manager_guard\n'
  fi
  sed -n 'p' /etc/hermes-manager/egress.nft
}
policy_input | /usr/sbin/nft --check --file -
policy_input | /usr/sbin/nft --file -
