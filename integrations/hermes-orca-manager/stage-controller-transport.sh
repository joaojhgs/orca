#!/bin/bash
# Stage a distinct forward-only key and broker; do not restart Orca or issue a manager grant.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
known_hosts=${1:?Provide the pinned worker known-hosts file}
[[ -f "$known_hosts" && ! -L "$known_hosts" ]]
ssh-keygen -F 10.0.2.123 -f "$known_hosts" >/dev/null
directory=$(dirname "$(readlink -f "$0")")
identity=/var/lib/orca-control/manager-transport
install -d -m 0700 -o orca -g orca "$identity"
install -m 0600 -o orca -g orca "$known_hosts" "$identity/known_hosts"
if [[ ! -e "$identity/id_ed25519" ]]; then
  sudo -u orca ssh-keygen -q -t ed25519 -N '' -C orca-private-manager-transport -f "$identity/id_ed25519"
fi
[[ ! -L "$identity/id_ed25519" && $(stat -c '%U:%a' "$identity/id_ed25519") == orca:600 ]]
install -m 0644 -o root -g root "$directory/controller-ipc-broker.mjs" /usr/local/libexec/orca-manager-ipc-broker.mjs
for service in orca-manager-ipc-broker orca-manager-transport; do
  install -m 0644 -o root -g root "$directory/$service.service" "/etc/systemd/system/$service.service"
  systemd-analyze verify "/etc/systemd/system/$service.service"
done
systemctl daemon-reload
systemctl enable --now orca-manager-ipc-broker.service
printf 'STAGED: credential-free private broker; transport is not started and Orca was not restarted.\n'
