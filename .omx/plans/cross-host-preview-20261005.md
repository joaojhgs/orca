# Connected execution-host previews

## Requirements and confirmed boundaries

- Discover and display VNC and already-connected Android devices from connected SSH execution environments, not the control VPS's localhost.
- User approved desktop personal's loopback VNC ports 5900, 5901 and 5902. Preserve game displays' existing view-only policy and passwords.
- No arbitrary port scanning, Wi-Fi ADB discovery/connect, automatic host service enumeration, new host SSH access, tailnet ACL widening, or public VNC/ADB listeners.
- Personal uses the desktop host network namespace. Loopback reachability is not sufficient authorization: require an operator-owned per-target allowlist.
- Desktop Orca, current chat, the detached personal relay and active game Codex PTYs must not be restarted. VPS deployment requires separate approval.

## Evidence

- `src/main/runtime/rpc/methods/computer.ts:44` resolves a local target and mints a VNC ticket; line 62 lists only local targets.
- `src/main/runtime/rpc/desktop-vnc-websocket-bridge.ts:45` always connects to control-host loopback.
- `src/main/computer/desktop-vnc-targets.ts:31` owns local target enumeration.
- `src/main/execution-observer/observer-client.ts:55` executes bounded operations through the already-connected inner SSH session and fences generations.
- `src/main/emulator/android/scrcpy-server-download.ts:1` depends on Electron: standalone remote Android code needs an Electron-free path override, not an entire remote Electron installation.
- Live inspection: VPS has neither VNC nor Android SDK; personal can reach desktop VNC 5900/5901/5902 and shared ADB 5037. Current ADB inventory is empty; Waydroid session is stopped. No Android device was started or connected.

## Implementation sequence

1. Define additive execution-host preview contracts and capabilities. Stable target/device identity includes execution host. Old clients retain local behavior; unsupported or disconnected remote hosts report unavailable and never substitute local devices.
2. Add operator-owned, bounded per-SSH-target preview policy. Approved VNC destinations are loopback-only, with numeric allowlisted ports and opaque IDs; credentials stay on execution host and are never returned in inventory. ADB inventory reads only an approved existing local ADB server and excludes Wi-Fi/network serials.
3. Reuse the execution observer for bounded inventory and availability probes. No broad scan and no ADB start-server/discovery. Fence every result to current connection generation.
4. Extend single-use, short-lived VNC tickets with host/generation identity. Bridge only through the existing inner SSH transport to the server-approved target. Reject expired, consumed, disconnected or stale-generation tickets before opening TCP. Never accept a request-selected host/port.
5. Reuse the independently built execution observer and existing Android PNG frame adapter for Android inventory, screenshot and input operations. No persistent sidecar, H264 transcoding, new listener or terminal relay update is needed. Device operations must reference approved inventory IDs.
6. Add host grouping to desktop/mobile preview pickers, distinguish no-device from disconnected/unsupported, and preserve existing input/view-only controls. No auto-selection across environments.
7. Validate hostile inputs, ticket replay/expiry, generation changes, duplicate IDs across hosts, Wi-Fi serial exclusion, missing SDK/sidecar, reconnect cleanup, bounded buffers/timeouts and view-only behavior. Test old clients/hosts and folder contexts.
8. Build in a separate 4 GiB/no-swap service, preserve relay bytes and active PTY incarnations, get VPS restart approval, deploy with rollback backup, and verify actual approved VNC streams. Android streaming remains unverified until an approved attached device is available.

## Acceptance / stop condition

- Browser and phone see only policy-approved resources from connected execution hosts, with host labels.
- Approved personal VNC targets stream through authenticated Orca tickets without public VNC or host SSH exposure.
- Android inventory does not discover/connect Wi-Fi devices; attach/control routes to the owning host and cannot select arbitrary services.
- Reconnect and mixed-version cases fail closed; active agent PTYs survive deployment.
- Source, fork and deployed release match; security tests and live checks are recorded. Missing Android hardware is explicitly reported, not claimed tested.

## Risks

- Host-network Distrobox shares host loopback: explicit policy is mandatory.
- Shared ADB inventory may contain network devices: filtering is mandatory even when they are reachable.
- Updating the terminal relay content hash can strand PTYs: observer/sidecar changes must not change that bundle.
- VPS RAM is constrained: forward encoded video, do not transcode on the controller; bound queues and concurrent streams.

## Implementation and validation

- Added `computer.execution-hosts.v1` and `emulator.execution-hosts.v1`. Default RPC calls retain their local-only behavior.
- Operator policy is installed root-owned at `/etc/orca-control/ssh-preview-policy.json`, selected by `ORCA_SSH_PREVIEW_POLICY_FILE`. Personal's 5900 is interactive; 5901/5902 are server-enforced view-only and use its existing password file. USB and emulator discovery are enabled only for personal. Network serials remain unapproved.
- VNC uses the existing inner SSH network transport with fixed approved loopback targets, single-use tickets, connection-generation fencing, bounded buffers and live policy revocation. Credentials are excluded from inventory and read with a bounded SSH filesystem request.
- Android uses bounded observer requests over existing SSH. Preview polling has one in-flight screenshot, cancels on detach, and fences its opaque stream identifier to the original host authority. Remote close detaches without powering off shared devices. Screenshots exceeding 3 MiB of base64 fail clearly before Orca's 4 MiB encrypted reply limit.
- Targeted tests: 82 passing across 14 files, including transport/policy revocation, forged targets, view-only input, Wi-Fi exclusion, authorization rechecks, stale streams, cancellation, oversized screenshots and fresh SSH setup deadlines. Changed-code quality gates pass all checks. Node and web typechecks each retain three unrelated baseline errors, none in this feature.
- Full build and final build passed in an isolated 4 GiB/no-swap user service. Desktop Orca was not restarted. VPS release: `/opt/orca-control/releases/cross-host-preview-20261005`; prior app and profile/database backups are retained for rollback. Deployed terminal relay is byte-identical to the previous release.
- Physical Android inventory is empty; Waydroid is stopped. Do not claim hardware streaming verified or start/connect Waydroid implicitly. Live VNC and PTY-preservation results are recorded after deployment.
- Live loopback transport: all three approved VNC displays authenticated and returned 230,400 bytes of raw framebuffer each (main 1024×768, game 1600×900, art 1280×800). Inventory initially omitted them because its four-second probe expired before fresh SSH setup; an independent SOCKS test measured 5.1 seconds. Corrected the remote probe to 15 seconds, preserving local probes at four seconds and covering the regression in tests. A second VPS-only restart was requested for that correction; do not deploy it without approval.
- Remote game remains connected/writable with incarnation `33531ddb-47a9-428a-a286-cf2fa89b4631`. Relay PID 1451 and game Codex PID 222370 kept their original start times across the first VPS restart.
