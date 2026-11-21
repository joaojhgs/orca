#!/bin/bash
# Stage immutable runtime bytes and a private service identity; do not move credentials or start it.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
if ! getent passwd hermes-manager >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/hermes-manager --create-home \
    --shell /usr/sbin/nologin hermes-manager
fi
[[ $(getent passwd hermes-manager | cut -d: -f6) == /var/lib/hermes-manager ]]
[[ $(getent passwd hermes-manager | cut -d: -f7) == /usr/sbin/nologin ]]
install -d -m 0700 -o hermes-manager -g hermes-manager /var/lib/hermes-manager
install -d -m 0700 -o hermes-manager -g hermes-manager /var/cache/hermes-manager
install -d -m 0755 -o root -g root /opt/hermes-manager
bash "$directory/stage-native-payload.sh"
private_home=/var/lib/hermes-manager/.hermes
install -d -m 0700 -o hermes-manager -g hermes-manager "$private_home" \
  "$private_home/profiles" "$private_home/profiles/orca-manager" \
  /var/cache/hermes-manager/pm-leases
if [[ ! -f /var/cache/hermes-manager/pm-install.lock ]]; then
  install -m 0600 -o hermes-manager -g hermes-manager /dev/null /var/cache/hermes-manager/pm-install.lock
fi
printf 'STAGED: hermes-manager has no login shell or sudo access. Runtime snapshot is root-owned.\n'
printf 'No credentials copied, no manager grant issued, no service or user session stopped.\n'
