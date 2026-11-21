#!/bin/bash
# Consistent pre-isolation recovery; pause only the integration's own memory writers.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
mode=${1:-legacy}
case "$mode" in
  legacy)
    profile=/home/developer/.hermes/profiles/orca-manager
    database=hermes_orca_memory
    services=(hermes-memory-api.service hermes-memory-llm-bridge.service)
    ;;
  private)
    profile=/var/lib/hermes-manager/.hermes/profiles/orca-manager
    database=hermes_manager_memory
    services=(hermes-memory-private.service hermes-memory-private-bridge.service)
    ! systemctl is-active --quiet hermes-orca-manager.service
    ;;
  *) printf 'Select legacy or private recovery scope.\n' >&2; exit 2 ;;
esac
[[ -d "$profile" && ! -L "$profile" ]]
[[ -f "$profile/auth.json" && ! -L "$profile/auth.json" ]]
[[ -f "$profile/config.yaml" && ! -L "$profile/config.yaml" ]]
install -d -m 0700 -o root -g root /var/backups/hermes-manager
recovery_directory=$(mktemp -d /var/backups/hermes-manager/pre-isolation.XXXXXXXX)
developer_uid=$(id -u developer)
user_systemctl() {
  if [[ "$mode" == private ]]; then
    systemctl "$@"
  else
    sudo -u developer -H env XDG_RUNTIME_DIR="/run/user/$developer_uid" systemctl --user "$@"
  fi
}
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
sudo -u postgres pg_dump --format=custom "$database" > "$recovery_directory/memory.pgdump"
install -d -m 0700 "$recovery_directory/profile"
cp --archive --no-dereference "$profile" "$recovery_directory/profile/orca-manager"
if [[ "$mode" == private ]]; then
  for plugin in hindsight orca-manager; do
    copied="$recovery_directory/profile/orca-manager/plugins/$plugin"
    [[ -L "$copied" && $(readlink "$copied") == "/opt/hermes-manager/plugins/$plugin" ]]
    unlink "$copied"
    cp --archive --no-dereference "/opt/hermes-manager/plugins/$plugin" "$copied"
  done
fi
tar --numeric-owner --acls --xattrs -C "$recovery_directory/profile" \
  -czf "$recovery_directory/profile.tar.gz" orca-manager
pg_restore --list "$recovery_directory/memory.pgdump" >/dev/null
tar -tzf "$recovery_directory/profile.tar.gz" >/dev/null
printf '%s\n' "$recovery_directory"
