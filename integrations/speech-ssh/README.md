# Dictation over an existing SSH host

This Linux deployment runs Whisper.cpp on the desktop Personal Distrobox’s RX 7600.
The paired browser captures audio; VPS Orca sends its WAV through the existing
approved TCP relay and receives JSON text. Inference happens after recording stops.
No cloud model account or speech model on the VPS is needed.

```text
Browser microphone → HTTPS Orca speech RPC
  → VPS 127.0.0.1:17785 (orca-speech-tunnel.service)
  → Orca ticketed WSS + existing Personal SSH relay
  → Personal 127.0.0.1:17784 (Caddy, bearer authentication)
  → Personal 127.0.0.1:17786 (Whisper.cpp / Vulkan RX 7600)
```

## Installed components

- Personal: `/home/developer/.local/share/orca-speech`, models and binaries.
- Personal: `/home/developer/.local/state/orca-speech`, lock and shader cache.
- Desktop user service: `orca-speech-desktop.service`, SSH heartbeat supervisor.
- VPS system service: `orca-speech-tunnel.service`, existing public CLI TCP forward.
- VPS network policy: `/etc/orca-control/network-forward-policy.json`.
- VPS speech provider: encrypted Orca credential store, configured through speech RPC.

`manifest.json` pins the upstream source, Caddy archive checksum, and model revisions
and checksums. The quantized multilingual small model supports English and Portuguese;
Silero VAD skips silence. Automatic language detection can misidentify short or
synthetic speech; select the intended language in Settings → Voice in that case.

The supplied units are installation-specific examples. Adjust SSH alias, paths,
controller private address and render device before reuse. They do not modify Orca’s
SSH relay bundle, daemon, terminal ownership, or Distrobox permissions.

## Build and install on Personal

Prerequisites: Ubuntu x86-64, C++/CMake/Ninja, curl, Python 3, Bubblewrap, flock,
Vulkan driver and an accessible AMD render node. Existing developer credentials
are not needed. Install development packages normally, or download/extract
`libvulkan-dev`, `glslc`, `libshaderc1`, and `spirv-headers` into a private toolchain.
Clone `https://github.com/ggml-org/whisper.cpp` at the manifest’s exact commit.

```sh
cmake -S "$root/src/whisper.cpp" -B "$root/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_VULKAN=ON \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON \
  -DCMAKE_PREFIX_PATH="$root/toolchain/usr" \
  -DVulkan_INCLUDE_DIR="$root/toolchain/usr/include" \
  -DVulkan_LIBRARY=/usr/lib/x86_64-linux-gnu/libvulkan.so.1 \
  -DVulkan_GLSLC_EXECUTABLE="$root/toolchain/usr/bin/glslc"
nice -n 10 cmake --build "$root/build" --target whisper-server --parallel 2
```

`root` is `/home/developer/.local/share/orca-speech`; export the extracted
`toolchain/usr/lib/x86_64-linux-gnu` in `LD_LIBRARY_PATH` during the build.
Copy the resulting server and verified Caddy binary into `bin/`.
Download the two model files at their pinned Hugging Face revisions and verify SHA256.
Put `Caddyfile` in `config/` and the two `run-*.sh` scripts in `bin/` (mode 0700).
Generate a dedicated random bearer key in `config/api-key`, mode 0600; never commit it.

Install `host-ssh-service.sh` as the desktop user’s `.local/libexec/orca-speech-desktop`.
Install its user unit, daemon-reload, and enable it. SSH heartbeats keep only this new
sandbox alive; loss of the supervisor tears it down. Existing sessions are unrelated.
Host user linger is required for operation without an interactive host login.

The sandbox mounts read-only system libraries, its own binaries/config/models,
a private writable cache and the selected GPU node. Developer home, projects,
agent credentials and parent `/proc` are absent. It shares Personal’s network
namespace for loopback transport; this is filesystem containment, not isolation
from other processes owned by the same developer or the host administrator.

Caddy binds explicitly to loopback. Authentication precedes route handling;
only GET `/health` and POST `/v1/audio/transcriptions` are proxied (22 MB cap).
The model-loading endpoint and static server UI are not exposed through the relay.
The internal Whisper listener is also loopback-only. Audio is processed in memory;
conversion, transcript printing and HTTP access logs are disabled.

## Connect the VPS

Back up the policy and append one route while preserving existing routes:

```json
{
  "id": "desktop-personal-dictation",
  "label": "Desktop Personal — Dictation",
  "targetId": "ssh-1786238480967-semdev",
  "host": "127.0.0.1",
  "port": 17784
}
```

Policy reads are live: no Orca restart. Changing this policy invalidates existing
forwarding tickets/streams, so check existing forwarded workloads first.
Install and enable the tunnel unit. It uses `orca network forward` and can reach
only loopback and this controller’s own private address. No new public ports.

Using an authorized settings client, call `speech.compatibleProvider.set` with
base URL `http://127.0.0.1:17785/v1`, model `whisper-small-q5_1`, and the dedicated
key; select `sttModel: "openai-compatible"` through `speech.settings.update`.
Keep the microphone selection in the browser; it is not an SSH microphone.
Preserve the remaining Voice settings. Never log the key or pairing links.

## Operations and rollback

```sh
# Desktop
systemctl --user status orca-speech-desktop.service
journalctl --user -u orca-speech-desktop.service
# VPS
sudo systemctl status orca-speech-tunnel.service
```

Both new units are enabled and recover independently. Dictation needs the desktop
online and Personal connected to VPS Orca. It fails rather than using a paid API
when that host is unavailable. Orca’s local-model unload timer does not unload this
remote service; stop only `orca-speech-desktop.service` to release its model.

To undo: select a different working Voice provider, stop/disable these two new units,
remove only the dictation route, clear the compatible speech credential if unused,
and then remove the dedicated speech installation. Preserve all other routes and
services. Before this setup, Voice selected an undownloaded Parakeet model.
