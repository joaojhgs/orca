#!/bin/bash
# Stage immutable memory code and public model cache, without moving credentials or data.
set -euo pipefail
umask 077
[[ $EUID == 0 ]]
memory_source=/home/developer/.local/share/uv/tools/hindsight-api
memory_runtime=/opt/hermes-manager/hindsight-api-0.10.1
[[ -d "$memory_source" && ! -L "$memory_source" ]]
if ! getent passwd hermes-memory >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/hermes-memory --create-home \
    --shell /usr/sbin/nologin hermes-memory
fi
[[ $(getent passwd hermes-memory | cut -d: -f6) == /var/lib/hermes-memory ]]
[[ $(getent passwd hermes-memory | cut -d: -f7) == /usr/sbin/nologin ]]
install -d -m 0700 -o hermes-memory -g hermes-memory /var/lib/hermes-memory \
  /var/cache/hermes-memory /var/cache/hermes-memory/huggingface
install -d -m 0755 -o root -g root /opt/hermes-manager
if [[ ! -d "$memory_runtime" ]]; then
  staging=$(mktemp -d /opt/hermes-manager/memory-staging.XXXXXXXX)
  cp --archive --reflink=auto "$memory_source/." "$staging/"
  chown -R root:root "$staging"
  chmod -R a+rX "$staging"
  mv -T "$staging" "$memory_runtime"
fi
[[ $(stat -c '%U' "$memory_runtime") == root ]]
"$memory_runtime/bin/python" -I -c \
  'import importlib.metadata; assert importlib.metadata.version("hindsight-api") == "0.10.1"'
model_cache=/var/cache/hermes-memory/huggingface/hub
if [[ ! -d "$model_cache" ]]; then
  [[ -d /home/developer/.cache/huggingface/hub && ! -L /home/developer/.cache/huggingface/hub ]]
  cp --archive --reflink=auto /home/developer/.cache/huggingface/hub "$model_cache"
  chown -R hermes-memory:hermes-memory "$model_cache"
fi
printf 'STAGED: immutable Hindsight 0.10.1 runtime and public model cache for nologin hermes-memory.\n'
printf 'No login/secret copied, database changed, service started, or user session stopped.\n'
