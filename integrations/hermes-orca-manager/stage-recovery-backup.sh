#!/bin/bash
# Consistent pre-isolation recovery; pause only the integration's own memory writers.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
profile=/home/developer/.hermes/profiles/orca-manager
[[ -d "$profile" && ! -L "$profile" ]]
[[ -f "$profile/auth.json" && ! -L "$profile/auth.json" ]]
[[ -f "$profile/config.yaml" && ! -L "$profile/config.yaml" ]]
install -d -m 0700 -o root -g root /var/backups/hermes-manager
recovery_directory=$(mktemp -d /var/backups/hermes-manager/pre-isolation.XXXXXXXX)
developer_uid=$(id -u developer)
user_systemctl() {
  sudo -u developer -H env XDG_RUNTIME_DIR="/run/user/$developer_uid" systemctl --user "$@"
}
services=(hermes-memory-api.service hermes-memory-llm-bridge.service)
running=()
for service in "${services[@]}"; do
  if user_systemctl is-active --quiet "$service"; then
    running+=("$service")
  fi
done
restore_services() {
  local original_exit=$?
  trap - EXIT
  if ((${#running[@]})); then
    user_systemctl start "${running[@]}" >&2 || original_exit=1
    for service in "${running[@]}"; do
      user_systemctl is-active --quiet "$service" || original_exit=1
    done
  fi
  exit "$original_exit"
}
trap restore_services EXIT
if ((${#running[@]})); then
  user_systemctl stop "${running[@]}"
fi
sudo -u postgres pg_dump --format=custom hermes_orca_memory > "$recovery_directory/memory.pgdump"
tar --numeric-owner --acls --xattrs -C /home/developer/.hermes/profiles \
  -czf "$recovery_directory/profile.tar.gz" orca-manager
pg_restore --list "$recovery_directory/memory.pgdump" >/dev/null
tar -tzf "$recovery_directory/profile.tar.gz" >/dev/null
printf '%s\n' "$recovery_directory"
