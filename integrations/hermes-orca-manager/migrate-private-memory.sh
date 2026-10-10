#!/bin/bash
# Single-owner profile move and scoped DB clone; rollback touches only this integration.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
source_profile=/home/developer/.hermes/profiles/orca-manager
private_profile=/var/lib/hermes-manager/.hermes/profiles/orca-manager
payload=/opt/hermes-manager/payload-66605471e9f0
[[ -f "$source_profile/auth.json" && ! -L "$source_profile/auth.json" ]]
[[ ! -e "$private_profile/auth.json" ]]
[[ $(systemctl show hermes-manager-private-plugin-admission-20261010.service -p Result --value) == success ]]
[[ $(systemctl show hermes-manager-private-plugin-admission-20261010.service -p ActiveState --value) == inactive ]]
[[ -f "$payload/manifest.json" && -d /opt/hermes-manager/plugins/hindsight ]]
[[ -f /var/backups/hermes-manager/pre-isolation.JDolqwD4/memory.pgdump ]]
for service in hermes-memory-private.service hermes-memory-private-bridge.service; do
  ! systemctl is-active --quiet "$service"
done
backup=$(mktemp -d /var/backups/hermes-manager/custody-migration.XXXXXXXX)
developer_uid=$(id -u developer)
user_systemctl() {
  sudo -u developer -H env XDG_RUNTIME_DIR="/run/user/$developer_uid" systemctl --user "$@"
}
old_services=(hermes-memory-api.service hermes-memory-llm-bridge.service)
running=()
enabled=()
for service in "${old_services[@]}"; do
  if user_systemctl is-active --quiet "$service"; then running+=("$service"); fi
  if user_systemctl is-enabled --quiet "$service"; then enabled+=("$service"); fi
done
database_created=false
role_created=false
prepared_moved=false
profile_moved=false
plugins_moved=false
legacy_protected=false
committed=false
rollback() {
  local result=$?
  trap - EXIT
  if ! $committed; then
    systemctl stop hermes-memory-private.service hermes-memory-private-bridge.service || result=1
    if $legacy_protected; then
      sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c 'ALTER DATABASE hermes_orca_memory OWNER TO developer; GRANT CONNECT ON DATABASE hermes_orca_memory TO developer;' || result=1
    fi
    if $profile_moved; then
      if $plugins_moved; then
        mv -T "$private_profile/plugins" "$backup/private-plugins"
        mv -T "$backup/original-plugins" "$private_profile/plugins"
      fi
      install -m 0600 "$backup/original-config.yaml" "$private_profile/config.yaml"
      mv -T "$private_profile" "$source_profile"
      chown -Rh developer:developer "$source_profile"
    fi
    if $prepared_moved; then mv -T "$backup/prepared-profile" "$private_profile"; fi
    if $database_created; then sudo -u postgres dropdb hermes_manager_memory || result=1; fi
    if $role_created; then sudo -u postgres dropuser hermes-memory || result=1; fi
    if ((${#enabled[@]})); then user_systemctl enable "${enabled[@]}" || result=1; fi
    if ((${#running[@]})); then user_systemctl start "${running[@]}" || result=1; fi
    printf 'Migration rolled back; recovery evidence retained in %s.\n' "$backup" >&2
  fi
  exit "$result"
}
trap rollback EXIT
if ((${#running[@]})); then user_systemctl stop "${running[@]}"; fi
sudo -u postgres pg_dump --format=custom hermes_orca_memory > "$backup/memory.pgdump"
tar --numeric-owner --acls --xattrs -C /home/developer/.hermes/profiles -czf "$backup/profile.tar.gz" orca-manager
install -m 0600 "$source_profile/config.yaml" "$backup/original-config.yaml"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c 'CREATE ROLE "hermes-memory" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;'
role_created=true
sudo -u postgres createdb --owner=hermes-memory hermes_manager_memory
database_created=true
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d hermes_manager_memory \
  -c 'CREATE EXTENSION vector; CREATE EXTENSION pg_trgm; REVOKE ALL ON DATABASE hermes_manager_memory FROM PUBLIC;'
pg_restore --list "$backup/memory.pgdump" | sed '/ EXTENSION - /d; / COMMENT - EXTENSION /d' > "$backup/restore.list"
pg_restore --no-owner --no-acl --use-list="$backup/restore.list" --file=- "$backup/memory.pgdump" | \
  sudo -u hermes-memory psql -q -v ON_ERROR_STOP=1 -d hermes_manager_memory >/dev/null
original_count=$(sudo -u postgres psql -At -d hermes_orca_memory -c 'SELECT count(*) FROM memory_units')
private_count=$(sudo -u hermes-memory psql -At -d hermes_manager_memory -c 'SELECT count(*) FROM memory_units')
[[ "$original_count" == "$private_count" && "$private_count" -gt 0 ]]
for key in memory-api.key memory-bridge.key; do
  install -m 0600 -o hermes-memory -g hermes-memory "$source_profile/$key" "/var/lib/hermes-memory/$key"
done
mv -T "$private_profile" "$backup/prepared-profile"
prepared_moved=true
mv -T "$source_profile" "$private_profile"
profile_moved=true
chown -Rh hermes-manager:hermes-manager "$private_profile"
chmod 0700 "$private_profile"
mv -T "$private_profile/plugins" "$backup/original-plugins"
plugins_moved=true
install -d -m 0700 -o hermes-manager -g hermes-manager "$private_profile/plugins"
for plugin in hindsight orca-manager; do
  ln -s "/opt/hermes-manager/plugins/$plugin" "$private_profile/plugins/$plugin"
  chown -h hermes-manager:hermes-manager "$private_profile/plugins/$plugin"
done
sudo -u hermes-manager -H env HERMES_HOME="$private_profile" \
  PYTHONPATH="$payload/hermes-agent:$payload/venv/lib/python3.14/site-packages" \
  "$payload/tools/python-3.14.7+20260901-linux-arm64/bin/python3" -P /usr/local/libexec/hermes-configure-private-profile.py
install -m 0755 -o root -g root "$directory/run-memory-api.sh" /usr/local/libexec/hermes-memory-api
for service in hermes-memory-private hermes-memory-private-bridge; do
  install -m 0644 -o root -g root "$directory/$service.service" "/etc/systemd/system/$service.service"
  systemd-analyze verify "/etc/systemd/system/$service.service"
done
systemctl daemon-reload
systemctl start hermes-memory-private-bridge.service hermes-memory-private.service
ready=false
for attempt in {1..60}; do
  if curl --silent --fail --max-time 2 http://127.0.0.1:8788/health >/dev/null &&
      /usr/bin/python3 -c 'import socket; s=socket.create_connection(("127.0.0.1",8789),timeout=2); s.close()' 2>/dev/null; then
    ready=true; break
  fi
  sleep 1
done
$ready
systemctl is-active --quiet hermes-memory-private.service hermes-memory-private-bridge.service
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c 'ALTER DATABASE hermes_orca_memory OWNER TO postgres; REVOKE CONNECT ON DATABASE hermes_orca_memory FROM PUBLIC, developer;'
legacy_protected=true
! sudo -u developer psql -q -d hermes_manager_memory -c 'SELECT 1' >/dev/null 2>&1
! sudo -u developer psql -q -d hermes_orca_memory -c 'SELECT 1' >/dev/null 2>&1
! sudo -u developer test -r "$private_profile/auth.json"
! sudo -u hermes-memory test -r "$private_profile/auth.json"
[[ $(stat -c '%U:%a' "$private_profile/auth.json") == hermes-manager:600 ]]
systemctl enable hermes-memory-private.service hermes-memory-private-bridge.service
user_systemctl disable "${old_services[@]}"
committed=true
printf 'PRIVATE_CUSTODY_OK: %s memory units; one OAuth owner; both memory services active.\n' "$private_count"
printf 'Coding user denied private login and both memory databases. Rollback: %s\n' "$backup"
