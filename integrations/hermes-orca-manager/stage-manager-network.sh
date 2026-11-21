#!/bin/bash
# Add only a policy for the staged nologin UID. No manager or user session is started/stopped.
set -euo pipefail
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
manager_uid=$(id -u hermes-manager)
memory_uid=$(id -u hermes-memory)
[[ $manager_uid =~ ^[0-9]+$ && $manager_uid != 0 && $manager_uid != $(id -u developer) ]]
[[ $memory_uid =~ ^[0-9]+$ && $memory_uid != 0 && $memory_uid != "$manager_uid" && $memory_uid != $(id -u developer) ]]
[[ $(getent passwd hermes-manager | cut -d: -f7) == /usr/sbin/nologin ]]
[[ $(getent passwd hermes-memory | cut -d: -f7) == /usr/sbin/nologin ]]
install -d -m 0755 -o root -g root /etc/hermes-manager
install -d -m 0755 -o root -g root /usr/local/libexec
install -m 0600 -o root -g root "$directory/hermes-manager-egress.nft" /etc/hermes-manager/egress.nft
sed -i "s/__MANAGER_UID__/$manager_uid/g; s/__MEMORY_UID__/$memory_uid/g" /etc/hermes-manager/egress.nft
install -m 0755 -o root -g root "$directory/hermes-manager-egress.sh" /usr/local/libexec/hermes-manager-egress
install -m 0644 -o root -g root "$directory/hermes-manager-egress.service" /etc/systemd/system/hermes-manager-egress.service
systemd-analyze verify /etc/systemd/system/hermes-manager-egress.service
systemctl daemon-reload
systemctl enable --now hermes-manager-egress.service
/usr/local/libexec/hermes-manager-egress
printf 'STAGED: only manager UID %s and memory UID %s are restricted on loopback; other users are unchanged.\n' "$manager_uid" "$memory_uid"
