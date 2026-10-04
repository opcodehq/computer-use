# Shared Mac desktop

Opcode attaches to the signed-in user's existing Mac desktop. Other people and
agents can observe that desktop, show named cursors, and request exclusive input
control. No VM, application migration, credential copying, or second login is
created. Apps already signed in on the target Mac keep their existing sessions.

## Prepare the target Mac

Use macOS 14 or newer with an active graphical login, Node.js 20+, Bun 1.3.10+,
and Xcode Command Line Tools. Install the npm CLI build containing these commands and its
permission-owning helper; the legacy standalone bundle does not contain
`desktop-api`:

```sh
# Install the package built from this version, then initialize the Mac helper:
cu install
cu doctor
```

In System Settings → Privacy & Security, grant **Opcode** Accessibility and Screen
Recording. Follow the installer's restart instructions if macOS requests them.
The broker connects to the installed helper's private, same-user Unix socket; it
does not run a standalone driver under a new permission identity. An older helper
must be updated before it understands the shared desktop methods.

Start a broker with a lifecycle identifier you retain for this desktop session:

```sh
cu desktop-api attach --display macos --generation mac-work-session-1 \
  --origin http://127.0.0.1:4311
cu desktop-api call --display macos --method health
```

The explicit origin permits the SSH viewer on client port 4311; use the same port
on each client. For an HTTPS reverse proxy, set its exact origin instead. To change
an existing broker’s origin, shut it down and attach again with new credentials.

The broker binds to loopback. One broker owns the user's Mac display. Repeating
attach with the same generation reuses it. Use the existing generation when
sharing; changing a generation is a lifecycle change, not a way to steal control.

## Share with a person or agent

On the target Mac, create a separate scoped credential for each participant:

```sh
cu desktop-api share --display macos --subject alice --role controller \
  --output "$HOME/alice-desktop.json"
cu desktop-api share --display macos --subject build-agent --role agent \
  --output "$HOME/build-agent-desktop.json"
```

Roles are `viewer`, `controller`, and `agent`. Viewers can watch and show a cursor;
controllers and agents can also request input control. Credentials expire after
one hour by default; `--ttl-ms` sets a shorter lifetime. Keep credential files
private. Never distribute the host registry descriptor or its administrative
token. The share command returns the grant ID for revocation:

```sh
cu desktop-api call --display macos --method revoke --args '{"id":"GRANT_ID"}'
```

For another computer, establish normal SSH authentication and verify the target's
host key first. A Tailnet SSH hostname or an SSH configuration alias works. On the
client computer, install the same npm CLI build (Node.js 20+); remote clients do
not need to install a local native helper. Keep this tunnel command running:

```sh
cu desktop-api tunnel --ssh user@my-mac \
  --remote-credential-file /Users/user/alice-desktop.json \
  --output "$HOME/alice-tunnel.json" --local-port 4311
```

The absolute remote credential path is on the target Mac. The tunnel fetches only
that scoped credential, forwards the loopback broker through OpenSSH, and deletes
its local credential when it closes. It does not disable SSH host verification or
reconnect and replay desktop input automatically.

In another client terminal:

```sh
cu desktop-api viewer --credential-file "$HOME/alice-tunnel.json"
cu desktop-api mcp --credential-file "$HOME/alice-tunnel.json"
```

Open the viewer URL in a browser. Its fragment contains a bearer credential, so
treat the URL as private. Use the MCP command as the stdio command in your agent's
MCP configuration. Give each independently controlled participant its own grant.
For HTTPS deployments, pass the externally configured HTTPS broker endpoint to
`share --endpoint`; TLS/reverse-proxy configuration is separate from the broker.

## Control and coordinates

Every participant has a named overlay cursor. Moving that cursor does not move
the Mac's system pointer or acquire control. The viewer shows the current input
owner. **Take control** transfers the lease, cancels queued input from the prior
owner, and fences its in-flight operation before the new owner can act. **Stop**
releases broker-held input. Wait for confirmation before intervening.

Agent tools follow this sequence: acquire a lease, observe the target, submit one
input with that lease and observation ID, and observe again to verify the outcome.
Renew the lease during longer workflows. The MCP connection automatically joins
as an agent, maintains its presence heartbeat, and publishes its proposed pointer
location; CLI clients can use the presence methods explicitly. Stale images, changed focus, changed
geometry, expired grants, and mismatched generations reject input. A lost reply
has unknown delivery; observe again instead of retrying the action.

Captures are PNGs in logical screen points, one image pixel per point, including
on Retina displays. Input coordinates are relative to the returned image. The
observation includes the target's desktop origin, which can be negative for a
window on another display. Full-display capture selects the primary display.
Use the window list and its IDs to select an exact window. Before physical input
to a window target, focus that window and obtain a fresh observation; otherwise
input is rejected. Before scrolling or pressing a held mouse button on a window,
hover inside that window and observe again; a pointer outside the target is rejected.
Window capture does not provide an isolated input session.

Supported input includes clicks, double/right clicks, hover, drag, vertical and
horizontal scroll, text, named keys and modifier combinations, held keys/buttons,
window focus, and launching an installed application by bundle ID. Text uses
Unicode events rather than replacing the clipboard. Fields identified by Accessibility as secure password fields
reject remote input; custom-drawn controls may not expose that classification. Keyboard shortcuts use the Mac's physical key map; text entry
is preferable when exact characters matter. Display resizing is unsupported.

## Boundaries and recovery

macOS has one physical desktop pointer and foreground keyboard target. Overlay
cursors provide multiplayer presence; independent simultaneous physical cursors
or eight isolated Simulator input streams are not provided. Agents can select
different Simulator windows, but physical actions are serialized through the
single lease. This API does not promise background interaction with arbitrary
apps or keep the user's pointer undisturbed during automation.

The broker controls only input routed through it. Local hardware input, other
applications, and separate CU semantic sessions can bypass its lease. There is
no OS-wide input lock or automatic takeover on physical mouse movement. Use Stop
or Take control and await confirmation before using the local mouse/keyboard;
do not run another physical-input automation tool on the same desktop. A native
operation already handed to macOS cannot be undone; cancellation waits for its
reply, and unconfirmed delivery remains unknown.

Screen locks, permission revocation, helper exits, logout, and inaccessible
windows can interrupt capture or input. Fix permissions/login first, restart the
broker if its helper connection was lost, and obtain fresh grants/observations as
required. The service does not reconnect and replay a pending native action. It
persists broker-held key/button state for release on startup. Broker shutdown
does not terminate apps or the installed helper.

Mac broker ownership uses a private per-user file lock held by its native helper
connection. Disconnects and crashes release the kernel lock automatically; the
lock file remains in place and must not be deleted to recover a session. The
private broker descriptor also remains after shutdown so a retiring broker cannot
remove a replacement broker's descriptor. `attach` checks the recorded endpoint
and replaces a stale descriptor when it starts the next broker.

The viewer polls screenshots; this is not a video/audio streaming transport.
Optional recordings require an installed FFmpeg with `libx264`; health reports
whether recording is available. Capture can include private desktop contents, so
share the desktop only with participants authorized to see the target account.
