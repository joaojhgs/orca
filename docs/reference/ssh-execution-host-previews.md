# SSH execution-host previews

Desktop and Android previews can use already-connected SSH execution environments. The controller does not scan the tailnet or infer permission from network reachability. Hosts sharing a machine's network namespace still require explicit approvals.

## Operator configuration

Set `ORCA_SSH_PREVIEW_POLICY_FILE` to an absolute operator-owned JSON file outside agent-writable directories. Without an override, Orca reads `ssh-preview-policy.json` in its user-data directory. Missing policy means no approved SSH previews; malformed policy fails closed.

Example (identifiers must match registered SSH targets):

```json
{
  "hosts": [
    {
      "targetId": "ssh-personal",
      "vnc": [
        {
          "id": "game",
          "label": "Game display",
          "port": 5901,
          "viewOnly": true,
          "passwordFile": "/home/developer/.config/game/vnc-password"
        }
      ],
      "adb": { "usb": true, "emulators": true, "serials": [] }
    }
  ]
}
```

VNC targets always resolve to `127.0.0.1` **inside the selected SSH environment's network namespace**. Password files belong to that environment and contain plaintext VNC passwords, not encrypted `rfbauth` files. Inventory exposes neither passwords nor password paths. Main desktops can explicitly set `viewOnly: false`; view-only targets reject keyboard, pointer, clipboard, power and display-resize messages on the server.

Android inventory reads `adb devices -l` on the execution environment. USB and emulator approvals do not approve network/mDNS devices. An already-connected Waydroid or network device needs its exact serial in `serials`; this does not initiate `adb connect`, pairing or Waydroid startup. SDK/ADB installation and device authorization must already be available in that environment. No skills or agent configuration are copied by this feature.

Policy changes take effect on the next inventory/request. Running VNC streams recheck policy within two seconds; Android streams reject stale connection generations or changed policy and require reattachment. Editing policy does not require restarting Orca.

## Clients and transport

`computer.desktopTargets` and `emulator.listDevices` accept optional `executionHosts: true`; omitted preserves legacy local inventory. Capability tokens are `computer.execution-hosts.v1` and `emulator.execution-hosts.v1`. Host names appear in the preview pickers, and device identity includes its host. A disconnected or unsupported environment is never substituted with a controller-local device.

VNC uses authenticated, short-lived, single-use Orca tickets and the existing inner SSH network transport. It does not require publicly exposing VNC or widening host SSH access. Buffers, connection counts and connect deadlines are bounded.

Android uses the independently built execution observer over existing SSH, not a replacement terminal relay. Browser preview polls PNG screenshots with one request in flight and supports tap, gesture, text, buttons and rotation. This is not an H264/scrcpy video stream; frame rate depends on SSH and screenshot latency. Screenshots exceeding 3 MiB of base64 are rejected before the encrypted reply limit. Detaching the preview does not power off shared devices. Arbitrary shell execution, application installation/launch, permissions, logcat and accessibility inspection are not implemented for remote preview IDs and fail explicitly.

Do not upgrade a live terminal relay solely for previews. Deployment of a new controller can retain its existing relay bundle and reconnect surviving remote PTYs.
