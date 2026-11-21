# Additional desktop viewers

Open an Emulator pane, choose **Desktop**, then select a desktop from **Desktop view**.
The main desktop retains interactive input. Extra desktops are view-only in Orca's
noVNC client. Switching or reconnecting closes only that viewer's connection; it
does not restart a desktop, terminal, agent, or computer-use provider.

## Server configuration

Create `desktop-vnc-targets.json` in Electron's `app.getPath('userData')` directory
on the Orca server (normally `~/.config/orca` on Linux). The main desktop is implicit
and always uses `127.0.0.1:5900`; do not include or override its `main` ID.

```json
{
  "targets": [
    {
      "id": "k-style-game",
      "label": "K-style game",
      "port": 5901,
      "viewOnly": true,
      "passwordFile": "/absolute/private/path/to/plain-vnc-password"
    },
    {
      "id": "k-style-art",
      "label": "K-style art / Blender",
      "port": 5902,
      "viewOnly": true,
      "passwordFile": "/absolute/private/path/to/plain-vnc-password"
    }
  ]
}
```

All destinations are server-loopback addresses. Start and manage the VNC servers
separately. For a passwordless server, omit `passwordFile`; otherwise this must be
a plaintext password file, **not** x11vnc's binary `-rfbauth` file. Protect it with
owner-only filesystem access (Linux: directory `0700`, file `0600`). Do not put
credentials in the repository, URL, application logs, or browser storage.

The registry reloads for discovery and ticket requests. After changing the config,
use **Reconnect desktop** to refresh the list; a runtime restart is not required.
An unreachable VNC server remains selectable and reports a stream error. The UI
does not start stopped desktops automatically or change `DISPLAY`.

## Authentication and compatibility

- Authenticated RPC discovers labels and view-only flags, without exposing ports
  or credential paths. Ticket requests return the selected desktop's credentials
  only to the authorized Orca client, which passes them to noVNC in memory.
- A random, single-use ticket expires after 30 seconds and binds a server-resolved
  destination. Browser query parameters cannot redirect the tunnel to another port.
- View-only is a **viewer behavior, not a security ACL**. The raw VNC proxy does not
  filter RFB input. Paired full-access Orca clients are trusted; a user needing a
  security-enforced observer account should use server-side VNC authorization.
- Old clients still open main with an empty ticket request. New clients fall back
  to main-only when discovery is unsupported. They reject a selected extra desktop
  when the host fails to echo its identity and view-only policy.
- Agent computer use remains on the main desktop. This selector is not an agent
  display-routing API and does not alter sidecar environment or GUI automation.

## Safe updates with running terminals

Build to a staging output directory, not the live `out` directory. Verify a baseline
build against the deployed artifacts before activating an already-dirty checkout.
Keep a recoverable copy of deployed output. Publish new hashed assets additively,
retain old assets for existing browser clients, and replace HTML last.

For this feature, only the main bundle and renderer/web assets need updating; do
not rebuild terminal native modules, CLI, relay, or terminal daemon. A backend code
update still requires a graceful runtime restart and briefly disconnects the UI.
Before restarting, inventory live terminal identities and verify their daemons and
SSH relays are independently owned. Afterward compare PTY/incarnation IDs and OS
PID/start times, not runtime-scoped CLI handles. If any owner is in-process or in
the service being stopped, do not assume the sessions will survive.

## Verification

Run the focused tests directly with Vitest, without invoking native rebuild scripts:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/main/computer/desktop-vnc-tickets.test.ts \
  src/main/computer/desktop-vnc-targets.test.ts \
  src/main/runtime/rpc/desktop-vnc-websocket-bridge.test.ts \
  src/main/runtime/rpc/methods/computer.test.ts \
  src/renderer/src/components/emulator-pane/desktop-computer-pane.test.tsx
```

Then visually verify each configured desktop connects, the extras show **View only**,
switching does not close other clients, and the pre-update terminal sessions remain
connected. Do not type into a running agent terminal as a continuity test.
