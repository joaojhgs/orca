#!/bin/bash
# Install the fixed console and reviewed unit; never start or enable the manager.
set -euo pipefail
umask 077
[[ $EUID == 0 && $# == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
for source in manager-console.py manager-console.sh hermes-orca-manager.service; do
  path="$directory/$source"
  [[ -f $path && ! -L $path && $(stat -c '%u' "$path") == 0 ]]
  [[ $(stat -c '%a' "$path") == 644 || $(stat -c '%a' "$path") == 755 ]]
done
[[ $(getent passwd developer | cut -d: -f6) == /home/developer ]]
[[ $(getent passwd hermes-manager | cut -d: -f6) == /var/lib/hermes-manager ]]
state=$(systemctl show hermes-orca-manager.service -p ActiveState --value)
[[ $state == inactive || $state == failed ]]
systemd-analyze verify "$directory/hermes-orca-manager.service"
install -d -m 0755 -o root -g root /opt/hermes-manager/console
backup=$(mktemp -d /var/backups/hermes-manager-console.XXXXXXXX)
for target in /etc/systemd/system/hermes-orca-manager.service \
  /usr/local/libexec/hermes-manager-console /usr/local/bin/hermes-manager-console \
  /etc/sudoers.d/hermes-manager-console /opt/hermes-manager/console/unit.sha256; do
  if [[ -e $target || -L $target ]]; then
    cp -a --parents "$target" "$backup"
  fi
done
install -m 0644 -o root -g root "$directory/hermes-orca-manager.service" \
  /etc/systemd/system/hermes-orca-manager.service
install -m 0755 -o root -g root "$directory/manager-console.py" /usr/local/libexec/hermes-manager-console
install -m 0755 -o root -g root "$directory/manager-console.sh" /usr/local/bin/hermes-manager-console
sha256sum /etc/systemd/system/hermes-orca-manager.service | cut -d ' ' -f1 \
  > /opt/hermes-manager/console/unit.sha256
chmod 0644 /opt/hermes-manager/console/unit.sha256
sudoers=$(mktemp /etc/sudoers.d/.hermes-manager-console.XXXXXXXX)
trap '[[ ! -f $sudoers ]] || unlink "$sudoers"' EXIT
printf 'developer ALL=(root) NOPASSWD: /usr/local/libexec/hermes-manager-console ""\n' > "$sudoers"
chmod 0440 "$sudoers"
visudo -cf "$sudoers"
mv -T "$sudoers" /etc/sudoers.d/hermes-manager-console
systemctl daemon-reload
printf 'STAGED: fixed Orca console; manager has not been started or enabled. Backup: %s\n' "$backup"
