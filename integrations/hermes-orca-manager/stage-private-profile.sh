#!/bin/bash
# Prepare dependency admission without copying OAuth or starting any services.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
directory=$(dirname "$(readlink -f "$0")")
private_profile=/var/lib/hermes-manager/.hermes/profiles/orca-manager
source_profile=/home/developer/.hermes/profiles/orca-manager
native_payload=/opt/hermes-manager/payload-66605471e9f0
[[ ! -e "$private_profile/auth.json" ]]
[[ -f "$source_profile/config.yaml" && ! -L "$source_profile/config.yaml" ]]
install -d -m 0700 -o hermes-manager -g hermes-manager "$private_profile" "$private_profile/plugins"
for state in tools installs cache logs; do
  install -d -m 0700 -o hermes-manager -g hermes-manager "/var/lib/hermes-manager/.hermes/$state"
done
install -d -m 0755 -o root -g root /opt/hermes-manager/plugins
if [[ ! -d /opt/hermes-manager/plugins/hindsight ]]; then
  [[ -d "$source_profile/plugins/hindsight" && ! -L "$source_profile/plugins/hindsight" ]]
  cp --archive "$source_profile/plugins/hindsight" /opt/hermes-manager/plugins/hindsight
  chown -R root:root /opt/hermes-manager/plugins/hindsight
  chmod -R a+rX,go-w /opt/hermes-manager/plugins/hindsight
fi
install -d -m 0755 -o root -g root /opt/hermes-manager/plugins/orca-manager
for file in __init__.py manager_adapter.py manager_state.py manager_tools.py orca_client.py objective_decisions.py \
    decision_runner.py private_secret.py memory_llm.py memory_tool_format.py prepare_memory.py \
    smoke_memory_api.py smoke_memory_llm.py plugin.yaml; do
  install -m 0644 -o root -g root "$directory/$file" "/opt/hermes-manager/plugins/orca-manager/$file"
done
for plugin in orca-manager hindsight; do
  target="$private_profile/plugins/$plugin"
  if [[ ! -e "$target" ]]; then
    ln -s "/opt/hermes-manager/plugins/$plugin" "$target"
    chown -h hermes-manager:hermes-manager "$target"
  fi
  [[ -L "$target" && $(readlink "$target") == "/opt/hermes-manager/plugins/$plugin" ]]
done
if [[ ! -e "$private_profile/config.yaml" ]]; then
  install -m 0600 -o hermes-manager -g hermes-manager "$source_profile/config.yaml" "$private_profile/config.yaml"
fi
install -m 0644 -o root -g root "$directory/configure-private-profile.py" /usr/local/libexec/hermes-configure-private-profile.py
sudo -u hermes-manager -H env HERMES_HOME="$private_profile" \
  PYTHONPATH="$native_payload/hermes-agent:$native_payload/venv/lib/python3.14/site-packages" \
  "$native_payload/tools/python-3.14.7+20260901-linux-arm64/bin/python3" \
  -P /usr/local/libexec/hermes-configure-private-profile.py
printf 'STAGED: private configuration and immutable plugins; OAuth remains in its original profile.\n'
