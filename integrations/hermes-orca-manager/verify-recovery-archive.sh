#!/bin/bash
# Root-only rehearsal against a disposable database and a private extracted profile.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
recovery_directory=${1:?Provide the private directory containing decrypted backup components}
[[ "$recovery_directory" =~ ^/var/backups/hermes-manager/restore-check\.[[:alnum:]]+$ ]]
[[ -d "$recovery_directory" && ! -L "$recovery_directory" ]]
[[ $(stat -c '%U:%a' "$recovery_directory") == root:700 ]]
[[ -f "$recovery_directory/memory.pgdump" && -f "$recovery_directory/profile.tar.gz" ]]
restore_database=hermes_recovery_validation_$(openssl rand -hex 8)
created=false
cleanup_database() {
  local original_exit=$?
  trap - EXIT
  if $created; then
    sudo -u postgres dropdb "$restore_database" || original_exit=1
  fi
  exit "$original_exit"
}
trap cleanup_database EXIT
sudo -u postgres createdb "$restore_database"
created=true
pg_restore --no-owner --no-acl --file=- "$recovery_directory/memory.pgdump" |
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$restore_database" >/dev/null
memory_count=$(sudo -u postgres psql -At -d "$restore_database" -c 'SELECT count(*) FROM memory_units')
[[ "$memory_count" =~ ^[0-9]+$ && "$memory_count" -gt 0 ]]
tar --numeric-owner --acls --xattrs -C "$recovery_directory" -xzf "$recovery_directory/profile.tar.gz"
directory=$(dirname "$(readlink -f "$0")")
/usr/bin/python3 "$directory/verify-recovered-profile.py" "$recovery_directory"
printf 'HINDSIGHT_ENCRYPTED_RECOVERY_OK: %s memory units; production database unchanged\n' "$memory_count"
