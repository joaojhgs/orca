# Existing Hermes profiles in Orca Bots

A Bot with `hermesProfile` is an interface to a named Hermes profile on an existing
SSH host. It does not import that profile into Orca, install Hermes on the controller,
or replace the Hermes gateway.

The owner creates the Bot through `bots.create`, supplying `hermesProfile`:

```json
{
  "name": "Personal",
  "hermesProfile": {
    "connectionId": "ssh-oci-coding-worker",
    "profile": "personal",
    "home": "/home/developer/.hermes/profiles/personal",
    "directory": "/home/developer/Documents/Obsidian Vault Origin"
  }
}
```

The home must be the named profile's directory. The SSH host must already be
registered. Its saved SSH identity/configuration and strict host-key checking are
used; no public port or forwarded SSH agent is needed. Hermes must already have a
working ACP adapter and its own provider authentication. Connection failures stay
failures: Orca never falls back to a different profile or a controller-local agent.

Open the Bot's Chat to talk to the profile. Orca stores the visible conversation;
Hermes stores the native ACP conversation in that profile. Reopening uses that same
native conversation. Telegram conversations keep their own histories and continue
independently, sharing the profile's existing native memory and Hindsight bank.
Changing the underlying profile of an existing conversation is intentionally not
an update operation: create another linked Bot instead.

Linked profiles skip Orca's first-run persona setup, local memory instructions,
linked skill installation, and memory maintenance. Their own SOUL, memory, plugins,
Composio accounts, terminal backend, event supervision and schedules remain in
Hermes. Configure those using native Hermes. Orca's Bot settings show the linked
profile rather than offering a second memory/connector configuration.

Creating the interface does not start a model turn. A provider process starts only
when a chat needs it. Closing its SSH client does not stop the Telegram gateway or
the existing event supervisor. No additional polling supervisor is created.

Hermes's existing Orca CLI/plugin integration remains the route for project and
session management. This connection does not grant additional host access, weaken
company/personal account boundaries, or copy credentials to the controller.
