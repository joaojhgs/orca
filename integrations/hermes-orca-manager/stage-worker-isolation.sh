#!/bin/bash
# Stage immutable runtime bytes and a private service identity; do not move credentials or start it.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
runtime=/opt/hermes-manager/runtime-66605471e9f0
source_home=/home/developer/.hermes
[[ -f "$source_home/hermes-agent/pyproject.toml" ]]
[[ $(sudo -u developer git -C "$source_home/hermes-agent" rev-parse HEAD) == 66605471e9f0b0832abbefaf625ce08e948ca540 ]]
if ! getent passwd hermes-manager >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/hermes-manager --create-home \
    --shell /usr/sbin/nologin hermes-manager
fi
[[ $(getent passwd hermes-manager | cut -d: -f6) == /var/lib/hermes-manager ]]
[[ $(getent passwd hermes-manager | cut -d: -f7) == /usr/sbin/nologin ]]
install -d -m 0700 -o hermes-manager -g hermes-manager /var/lib/hermes-manager
install -d -m 0700 -o hermes-manager -g hermes-manager /var/cache/hermes-manager
install -d -m 0755 -o root -g root /opt/hermes-manager
if [[ ! -d "$runtime" ]]; then
  staging=$(mktemp -d /opt/hermes-manager/runtime-staging.XXXXXXXX)
  tar -C "$source_home" --exclude=.git --exclude=node_modules --exclude=__pycache__ \
    --exclude=tests --exclude=website -cf - tools installs hermes-agent | tar -C "$staging" -xf -
  chown -R root:root "$staging"
  chmod 0755 "$staging"
  mv -T "$staging" "$runtime"
fi
[[ -f "$runtime/hermes-agent/hermes_cli/main.py" ]]
[[ -x "$runtime/tools/python-3.14.7+20260901-linux-arm64/bin/python3" ]]
[[ $(stat -c '%U' "$runtime") == root ]]
chmod -R a+rX "$runtime"
private_home=/var/lib/hermes-manager/.hermes
install -d -m 0700 -o hermes-manager -g hermes-manager "$private_home" \
  "$private_home/profiles" "$private_home/profiles/orca-manager" \
  /var/cache/hermes-manager/pm-leases
if [[ ! -f /var/cache/hermes-manager/pm-install.lock ]]; then
  install -m 0600 -o hermes-manager -g hermes-manager /dev/null /var/cache/hermes-manager/pm-install.lock
fi
printf 'STAGED: hermes-manager has no login shell or sudo access. Runtime snapshot is root-owned.\n'
printf 'No credentials copied, no manager grant issued, no service or user session stopped.\n'
