#!/usr/bin/env bash
set -euo pipefail
source_root=$(cd "$(dirname "$0")/../.." && pwd)
metadata=${1:?Provide an absolute directory containing DEPLOYMENT.json}
archive=${2:?Provide an absolute output archive path}
[[ $metadata = /* && $archive = /* && -f $metadata/DEPLOYMENT.json ]]
node "$source_root/integrations/electron-server-deployment/stage-runtime-data.mjs" "$metadata"
tar -C "$source_root" -cf - out/main out/web \
  -C "$metadata" DEPLOYMENT.json node_modules/emojibase-data | gzip -1 > "$archive"
