#!/usr/bin/env bash
set -euo pipefail
heartbeat() { while true; do printf 'keepalive\n'; sleep 10; done; }
heartbeat | ssh -T -S none -o BatchMode=yes -o ConnectTimeout=15 \
 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 \
 personal-distrobox /home/developer/.local/share/orca-speech/bin/run-sandbox.sh
