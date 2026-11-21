#!/bin/bash
# Add a no-shell, Unix-forward-only identity; keep existing SSH sessions and user policy.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
public_key=${1:?Provide the controller-created transport public key file}
[[ -f "$public_key" && ! -L "$public_key" ]]
ssh-keygen -l -f "$public_key" >/dev/null
[[ $(wc -l < "$public_key") == 1 ]]
[[ $(cut -d' ' -f1 "$public_key") == ssh-ed25519 ]]
directory=$(dirname "$(readlink -f "$0")")
getent passwd hermes-manager >/dev/null
if ! getent passwd hermes-transport >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/hermes-transport --create-home \
    --shell /usr/sbin/nologin hermes-transport
fi
[[ $(getent passwd hermes-transport | cut -d: -f7) == /usr/sbin/nologin ]]
[[ $(getent passwd hermes-transport | cut -d: -f6) == /var/lib/hermes-transport ]]
install -d -m 0700 -o hermes-transport -g hermes-transport /var/lib/hermes-transport
install -d -m 0755 -o root -g root /etc/hermes-manager
keys=/etc/hermes-manager/transport-authorized-keys
prepared=$(mktemp /etc/hermes-manager/transport-key.XXXXXXXX)
config=/etc/ssh/sshd_config.d/20-hermes-manager-transport.conf
new_config=false
cleanup() {
  local result=$?
  trap - EXIT
  unlink "$prepared"
  if ((result != 0)) && $new_config; then unlink "$config"; fi
  exit "$result"
}
trap cleanup EXIT
printf 'restrict,port-forwarding,command="/bin/false" ' > "$prepared"
sed -n 'p' "$public_key" >> "$prepared"
if [[ -e "$keys" ]]; then
  cmp -s "$keys" "$prepared" || { printf 'Existing transport key differs; operator review required.\n' >&2; exit 1; }
fi
install -m 0644 -o root -g root "$prepared" "$keys"
install -m 0644 -o root -g root "$directory/hermes-manager-transport.tmpfiles" /etc/tmpfiles.d/hermes-manager-transport.conf
systemd-tmpfiles --create /etc/tmpfiles.d/hermes-manager-transport.conf
if [[ -e "$config" ]]; then
  cmp -s "$config" "$directory/hermes-manager-transport.conf" || exit 1
else
  new_config=true
fi
install -m 0644 -o root -g root "$directory/hermes-manager-transport.conf" "$config"
/usr/sbin/sshd -t
/usr/sbin/sshd -T -C user=hermes-transport,host=code-worker,addr=10.0.1.24 | \
  /usr/bin/python3 -c '
import sys
rows = [line.strip().split(" ", 1) for line in sys.stdin]
values = dict(rows)
assert values["allowtcpforwarding"] == "remote"
assert values["permitlisten"] == "none"
assert values["permitopen"] == "none"
assert values["allowstreamlocalforwarding"] == "remote"
assert values["forcecommand"] == "/bin/false"
assert values["permittty"] == "no"
assert values["authorizedkeysfile"] == "/etc/hermes-manager/transport-authorized-keys"
allowed = [value for key, value in rows if key == "allowusers"]
assert {"ubuntu", "developer", "hermes-transport"} <= set(allowed)
'
systemctl reload ssh.service
printf 'STAGED: no-shell private Unix transport; existing SSH sessions/users unchanged.\n'
