#!/bin/bash
# Recoverable cleanup of malformed seeded wheel links, not dependencies or PM selection state.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
cache=/var/lib/hermes-manager/.hermes/cache/uv
[[ -d "$cache" && ! -L "$cache" && $(stat -c '%U' "$cache") == hermes-manager ]]
[[ -f "$cache/.seeded" && ! -L "$cache/.seeded" ]]
bad_wheel="$cache/wheels-v6/pypi/ruamel-yaml/0.18.16-py3-none-any"
[[ -d "$bad_wheel" && ! -L "$bad_wheel" ]]
! systemctl is-active --quiet hermes-manager-private-plugin-admission-20261010.service
install -d -m 0700 -o root -g root /var/backups/hermes-manager
backup=$(mktemp -d /var/backups/hermes-manager/malformed-cache.XXXXXXXX)
for part in wheels-v6 sdists-v9; do
  [[ -d "$cache/$part" && ! -L "$cache/$part" ]]
  mv -T "$cache/$part" "$backup/$part"
done
printf 'Malformed regenerable wheel caches preserved in %s; package locks/selection unchanged.\n' "$backup"
