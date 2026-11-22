#!/usr/bin/env bash
set -euo pipefail
children=()
cleanup() {
 trap - EXIT INT TERM HUP
 if ((${#children[@]})); then kill "${children[@]}" 2>/dev/null || true; wait "${children[@]}" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM HUP
/app/bin/whisper-server -m /models/ggml-small-q5_1.bin -l auto -t 4 \
 --host 127.0.0.1 --port 17786 --inference-path /v1/audio/transcriptions \
 --public /empty-public --vad --vad-model /models/ggml-silero-v6.2.0.bin \
 --vad-min-silence-duration-ms 700 --vad-speech-pad-ms 300 &
children+=("$!")
for ((attempt=0; attempt<120; attempt++)); do
 kill -0 "${children[0]}"
 if curl -fsS http://127.0.0.1:17786/health >/dev/null; then break; fi
 sleep 1
done
curl -fsS http://127.0.0.1:17786/health >/dev/null
ORCA_SPEECH_KEY=$(cat /config/api-key) GOMAXPROCS=2  /app/bin/caddy run --config /config/Caddyfile --adapter caddyfile &
children+=("$!")
wait -n "${children[@]}"
exit 1
