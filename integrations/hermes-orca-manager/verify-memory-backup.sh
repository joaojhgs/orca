#!/bin/bash
# Administrator-only restore rehearsal. The production DB is never overwritten.
set -euo pipefail
backup_directory=/home/developer/.hermes/profiles/orca-manager/backups
restore_database=hermes_memory_restore_validation
if sudo -n -u postgres psql -At -d postgres -c "SELECT 1 FROM pg_database WHERE datname='$restore_database'" | rg -q 1; then
  echo 'Refusing to overwrite an existing validation database.' >&2
  exit 1
fi
sudo -n -u developer install -d -m 0700 "$backup_directory"
memory_backup_path=$(sudo -n -u developer mktemp --tmpdir="$backup_directory" memory-validation.XXXXXX.pgdump)
sudo -n -u developer pg_dump --format=custom --file="$memory_backup_path" hermes_orca_memory
sudo -n -u postgres createdb --owner=developer "$restore_database"
trap 'sudo -n -u postgres dropdb hermes_memory_restore_validation' EXIT
sudo -n -u developer pg_restore --no-owner --no-acl --file=- "$memory_backup_path" |
  sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$restore_database" >/dev/null
original_count=$(sudo -n -u postgres psql -At -d hermes_orca_memory -c 'SELECT COUNT(*) FROM memory_units')
restored_count=$(sudo -n -u postgres psql -At -d "$restore_database" -c 'SELECT COUNT(*) FROM memory_units')
test "$original_count" = "$restored_count"
echo "HINDSIGHT_POSTGRES_RESTORE_OK: $original_count memory units; private backup $memory_backup_path"
