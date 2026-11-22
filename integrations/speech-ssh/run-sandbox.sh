#!/usr/bin/env bash
set -euo pipefail
root=/home/developer/.local/share/orca-speech
state=/home/developer/.local/state/orca-speech
umask 077
mkdir -p "$state/cache"
exec 9>"$state/service.lock"
flock -n 9 || exit 75
child=
cleanup() {
 trap - EXIT INT TERM HUP
 if [[ -n "$child" ]]; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM HUP
bwrap --unshare-user --unshare-pid --die-with-parent --cap-drop ALL --clearenv \
 --ro-bind /usr /usr --symlink usr/bin /bin \
 --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
 --dev /dev --dir /dev/dri --dev-bind /dev/dri/renderD128 /dev/dri/renderD128 \
 --ro-bind /sys /sys --tmpfs /tmp --tmpfs /run --dir /empty-public \
 --ro-bind "$root/bin" /app/bin --ro-bind "$root/config" /config \
 --ro-bind "$root/models" /models --bind "$state/cache" /cache \
 --setenv PATH /usr/bin:/bin --setenv LANG C.UTF-8 \
 --setenv XDG_CONFIG_HOME /cache/config --setenv XDG_DATA_HOME /cache/data \
 --setenv XDG_CACHE_HOME /cache --setenv MESA_SHADER_CACHE_DIR /cache/mesa \
 --setenv DRI_PRIME 'pci-0000_03_00_0!' \
 --setenv VK_DRIVER_FILES /usr/share/vulkan/icd.d/radeon_icd.json \
 --chdir /tmp /app/bin/run-inside.sh &
child=$!
while kill -0 "$child" 2>/dev/null; do
 if ! read -r -t 35 heartbeat; then exit 1; fi
done
wait "$child"
