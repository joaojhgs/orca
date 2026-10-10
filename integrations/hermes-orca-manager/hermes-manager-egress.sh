#!/bin/bash
# Do not reload or flush any other host firewall table.
set -euo pipefail
[[ $EUID == 0 ]]
if /usr/sbin/nft list table inet hermes_manager_guard >/dev/null 2>&1; then
  exit 0
fi
/usr/sbin/nft --check --file /etc/hermes-manager/egress.nft
/usr/sbin/nft --file /etc/hermes-manager/egress.nft
