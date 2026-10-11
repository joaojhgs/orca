#!/bin/bash
# Publish a checked immutable candidate; do not switch plugins, credentials or services.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
revision=${1:?Provide the source commit}
cli=${2:?Provide the checked standalone CLI bundle}
[[ $revision =~ ^[a-f0-9]{40}$ ]]
[[ -f $cli && ! -L $cli ]]
[[ $(stat -c '%U' "$cli") == root ]]
destination="/opt/hermes-manager/candidates/$revision"
if [[ -e $destination ]]; then
  [[ -d $destination && ! -L $destination ]]
  (cd "$destination" && sha256sum --check --status SHA256SUMS)
  cmp "$cli" "$destination/cli/index.cjs"
  for source in "$directory"/*.py "$directory/plugin.yaml"; do
    cmp "$source" "$destination/plugin/$(basename "$source")"
  done
  printf 'Existing candidate verified; active integration unchanged.\n'
  exit 0
fi
install -d -m 0755 -o root -g root /opt/hermes-manager/candidates
prepared=$(mktemp -d /opt/hermes-manager/candidates/.stage.XXXXXXXX)
trap 'if [[ -d $prepared ]]; then find "$prepared" -type f -delete; find "$prepared" -depth -type d -empty -delete; fi' EXIT
install -d -m 0755 -o root -g root "$prepared/plugin" "$prepared/cli"
for source in "$directory"/*.py "$directory/plugin.yaml"; do
  [[ -f $source && ! -L $source && $(stat -c '%U' "$source") == root ]]
  install -m 0644 -o root -g root "$source" "$prepared/plugin/$(basename "$source")"
done
install -m 0644 -o root -g root "$cli" "$prepared/cli/index.cjs"
(
  cd "$prepared"
  sha256sum plugin/*.py plugin/plugin.yaml cli/index.cjs > SHA256SUMS
  chmod 0644 SHA256SUMS
  sha256sum --check --status SHA256SUMS
)
# Keep a failed partial publish inaccessible; only a complete directory gets the versioned name.
chmod 0755 "$prepared"
mv -T "$prepared" "$destination"
printf 'STAGED: %s; active plugin, CLI, OAuth, grants and all services unchanged.\n' "$destination"
