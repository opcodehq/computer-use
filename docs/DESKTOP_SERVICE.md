# Shared desktop service (protocol 1)

Opcode owns capture, input arbitration, scoped local credentials and recording.
The host owns workspace accounts, provider allocation, ingress and lifecycle.
No reasoning model or model key is needed. Linux X11 and macOS are implemented backends. For Mac installation, permissions,
coordinates and limitations, see [Shared Mac desktop](MAC_DESKTOP.md). This is
not a Wayland, Windows, audio or multi-monitor desktop implementation.

## Install and attach

```sh
npm install --omit=optional @opcodehq/cu
# Node 20+, C compiler and X11/XTest headers for minimal source installation.
# Xvfb is unnecessary when attaching to a provider's running X server.
npx cu install --minimal
npx cu desktop-api attach --display :1 --authority /path/to/Xauthority \
  --generation workspace-123-boot-4
npx cu desktop-api call --display :1 --method health
npx cu desktop-api mcp --display :1
```

Replace the display, authority and generation with verified host values. Do not
start `cu desktop` around an existing provider desktop: that creates another
Xvfb. Attach creates only an Opcode broker and never kills/resets the X server.
It checks the effective UID and captures the existing root display before ready.
Repeated attach reuses that display's broker. Local `:N`, `:N.0`, and `unix:N`
normalize to the same identity. An abstract Unix socket admits one broker per
display within the network namespace. A private descriptor permits trusted same-user CLI discovery.
This is application arbitration, not isolation from root or arbitrary X clients.

`cu install --minimal` uses Node and compiles only the Linux runtime; legacy
source-driven window commands require Bun.

`--omit=optional` supplies the raw desktop service and its MCP adapter, not the
legacy model/browser CLI. Optional packages install by default for existing
users. Linux models are now an explicit `cu install --with-model` download;
`CU_PERCEPTION=detector` requires legacy window enrichment; `CU_PERCEPTION=raw`
skips it. Legacy auto mode uses an available installed detector and otherwise
falls back to raw. Mac installation behavior is unchanged.

`serve --config FILE` runs in the foreground for a host supervisor. Config:

```json
{"display":":1","authority":"/path/to/Xauthority","uid":1000,
 "generation":"host-controlled-generation","helper":"/path/to/cu-x11",
 "directory":"/private/recordings","origin":"https://desktop.example.com",
 "basePath":"/desktop"}
```

Directories containing recordings and connection descriptors must be private
and owned by this user. The broker listens only on loopback. Provide a trusted
tunnel/reverse proxy; do not expose its port directly to the internet.

## One API for CLI, MCP and embedding

POST `<endpoint>/rpc` with `Authorization: Bearer TOKEN` and:

```json
{"id":"unique-request-id","generation":"host-controlled-generation",
 "method":"observe","args":{"target":{"kind":"display"}}}
```

Responses include protocol version, generation, `ok` and `result` or a structured
`error` with `code`, `message`, and `delivery`. CLI wraps this exact endpoint;
MCP `computer_*` tools also use it. `computer_observe` returns an image content
block plus metadata. Use `--credential-file FILE` for scoped clients. Its private
JSON shape is `{ "endpoint": "http://127.0.0.1:PORT/desktop", "token": "…",
"generation": "…" }`. Do not give untrusted clients the host descriptor.

| Methods | Arguments / behavior |
| --- | --- |
| `health`, `apps`, `windows`, `state` | Capabilities, installed application IDs, mapped windows, ownership/recording state. |
| `observe` | `target`: `{kind:"display"}` or `{kind:"window",id:WINDOW_ID}`. Raw PNG and geometry; no inference. |
| `acquire`, `takeover` | `ttlMs` 1–60 seconds (default 30). Returns a lease ID. Takeover fences the prior controller. |
| `renew`, `release` | `leaseId`. Renew every 10 seconds for continuous control. |
| `input` | `leaseId`, `observationId`, `action`. See actions below. |
| `resize` | `leaseId`, `width` 320–4096, `height` 240–4096. Requires an existing RandR framebuffer mode; returns unsupported otherwise. Fences ownership: acquire and observe again. |
| `stop` | Cancel queued/in-flight input and release held inputs. |
| `grant` | Host only: `subject`, `scopes`, `ttlMs` (up to one hour). Returns a scoped bearer grant. |
| `revoke` | Host only: grant `id`. Cancels its active input/recording. |
| `rebind` | Host only: new `generation`. Invalidates grants, leases, observations and recordings. |
| `shutdown` | Host only: stop the broker and media workers, preserving the attached display. |

Actions: `click`, `doubleClick`, `rightClick`, `hover` with `x,y`; `drag` adds
`toX,toY`; `scroll` has `amount` −30…30 and `axis` x/y; `text` has UTF-8 `text`
(up to 8000 characters), with optional `pasteKey: "Control+Shift+v"` or `"Shift+Insert"` for terminals (known terminal classes select the matching shortcut automatically; other apps use Control+v); `key` uses names/combinations such as `Control+a`;
`keyDown`/`keyUp` hold one key; `buttonDown`/`buttonUp` take button 1–3;
`focus` takes `windowId`; `launch` takes an installed `.desktop` `appId`.
Launching uses the desktop entry through `gio`, not caller-supplied shell text.

Coordinates are pixels in the delivered image, with explicit identity scale and
root offsets in `imageToDesktop`. No implicit crops/downscaling/CSS coordinates.
Full-display input respects keyboard focus. Window-target input raises/focuses
that window, matching the legacy isolated X11 behavior. Text pastes through that
X display's clipboard and replaces its previous selection (Shift+Insert also sets PRIMARY); preservation is not
promised. Verify the resulting app content.

Observations are grant-bound, expire after 30 seconds and are consumed by input.
Geometry, focus and a sampled pixel-difference check reject changed scenes.
This check tolerates small changes but can reject animation and cannot detect
every UI change. There is a time-of-check/time-of-use gap; dispatch acknowledgement
is not verified app success. There are at most 16 queued mutations, eight retained observations per grant,
and 512 observations overall. Observations older than 30 seconds are evicted. Duplicate mutation IDs return the last result while present in the
512-entry cache; reuse with different content is rejected. Never retry uncertain
input automatically or promise exactly-once delivery across crashes.

One broker serves all new MCP, CLI and viewer clients. While it is registered,
legacy window input and browser mutations on that display fail closed instead
of opening a second control path. Existing window/browser workflows still work
on displays without a broker. The native helper and arbitrary X clients remain
outside this application-level trust boundary.

## Viewing and reverse proxies

GET `<endpoint>/view#TOKEN` opens the standalone viewer. Fragment tokens are
removed from the address bar and held in sessionStorage; API requests use
Authorization headers. Add `?windowId=ID` before the fragment for window-only viewing. A viewer grant needs `viewer-read`; human control also
needs `input-control`. Observer buttons are hidden and mutations are rejected
server-side. Never use the host master token as a viewer link.

For embedding, use `/session` for generation/scopes, `/frame` for a PNG observation,
`state` for controller/recorder status, and the same control RPCs. The web UI
supports fullscreen, reconnect, resize requests, pointer drag, keyboard and
explicit paste. Blur/hidden state releases human control. Browser refresh cannot
resume a lease silently. Frames are demand-driven, coalesced/cached for 100 ms,
and polled by the standalone UI every 200 ms. This is bounded image streaming,
not WebRTC or high-frame-rate video. No viewer demand means no viewer polling.
Recording and explicit agent observations remain independent.

Use `basePath` and an exact external `origin` behind a proxy. Unknown Origins are
rejected; forwarded identity/host headers are not trusted. See
`examples/desktop-proxy.mjs`: the host supplies an authorization function that
verifies the current account/workspace and selects a scoped backend credential.
Keep a stable scoped credential per client session; do not mint a new grant per request.
The proxy must revoke that credential when host authorization is withdrawn.
The reference callback is not a replacement for host account authentication.

## Multiplayer and remote clients

`share` creates a private, expiring credential without printing its token:

```sh
cu desktop-api share --display :1 --subject alice --role controller --output /private/alice.json
cu desktop-api viewer --credential-file /private/alice.json
cu desktop-api mcp --credential-file /private/alice.json
```

Use a separate grant for each person or agent. `viewer` grants watch/presence;
`controller` and `agent` also grant input. Administrative descriptors are refused
by the viewer. The host can revoke each returned grant ID independently.

Add `--endpoint https://desktop.example.com/desktop` when sharing through your
configured TLS proxy. Remote plaintext endpoints and redirects are rejected.
For SSH, use `tunnel --ssh HOST --remote-credential-file ABSOLUTE_PATH --output
LOCAL_PATH`. It uses existing OpenSSH keys/config and known hosts, waits for a
confirmed forward before sending any token, and deletes its local credential
when closed. The tunnel remains in the foreground; it does not reconnect or
replay input. Configure the broker `--origin http://127.0.0.1:4311` for the
default forwarded viewer port, or match your chosen `--local-port`. The native
broker origin remains permitted. HTTPS ingress uses its exact configured origin.

The additive `presence` scope admits these methods:

| Method | Behavior |
| --- | --- |
| `presence.join` | Optional `name` and display-only `role` (`human`/`agent`); returns a participant ID/color. |
| `presence.update` | Owned `participantId`, optional `cursor` (null to hide, otherwise normalized `x,y` and optional `target`, default display); refreshes its heartbeat. |
| `presence.leave` | Removes the owned participant and fences its associated input lease. |
| `presence.list` | Requires `viewer-read`; returns participants and current controller, never lease IDs. |

Join is bounded to eight tabs per grant and 64 participants per broker. Heartbeats
expire after 15 seconds; update rate is capped at 25/second per participant.
Names are untrusted display text. Roles do not confer permission. `acquire` and
`takeover` accept an optional owned `participantId`; legacy clients continue
working without presence. Revocation, expiry, shutdown and rebind remove presence
and fence associated input. MCP joins as an agent and maintains its heartbeat;
the browser updates cursor position at most ten times per second. `/frame` carries
presence and controller state alongside the image. Window cursors are only shown
in viewers of that same target.

Actual OS input remains exclusive. Visual cursor updates never inject input.
Takeover waits for previous input cleanup. Failed held-key/button releases remain
journaled and block control until cleanup succeeds, including after restart.
Local hardware and programs outside this broker remain outside arbitration.

## Recording

Display resizing also requires the `xrandr` command and a compatible existing display mode.

Install FFmpeg with libx264 separately (or set `CU_FFMPEG` to its executable). Health reports
whether it is available. No encoder or recording starts during installation.

| Method | Arguments |
| --- | --- |
| `recording.start` | `target`, `fps` 1–30 (default 10), `maxBytes` 1 MB–1 GiB (default 100 MB), `maxSeconds` 1–3600 (default 300). |
| `recording.pause`, `recording.resume`, `recording.stop` | Recording `id`. Stop is repeatable. |
| `recording.list` | Metadata including state, frame count, dropped frames, bytes and encoded duration. |
| `recording.delete` | Recording `id`; active recordings must be stopped first. |

One active recorder per display. PNG frames share the broker capture producer;
FFmpeg encodes H.264 video in fragmented MP4. The initial frame size stays fixed;
subsequent resolutions fit with letterboxing. Paused intervals are omitted. Wall
clock duration includes pauses for the maximum-duration limit. Capture lag and
backpressure are reported as dropped frames; achieved fps is not guaranteed.
Encoding and file quotas do not block input admission or stop. The output writer enforces the byte limit exactly; reaching it can leave an
incomplete final fragment and marks the recording failed with a recoverable prefix. There is no automatic
secret redaction or audio capture.

GET `/artifacts/ID` requires `recording-read` and supports one explicit byte range.
`recording-start`, `recording-read` and `recording-delete` are separate scopes.
Deletion does not retroactively erase bytes already downloaded; open files may
finish an in-progress read. Grants are rechecked during downloads. Files are
private, IDs are random, and callers never supply export filesystem paths.

Daemon restart marks unfinished metadata `interrupted`; a fragmented MP4 may be
partially playable but is not represented as a successfully finalized recording.
Encoder failure marks `failed`. Retention/total-workspace disk quotas belong to
the host. Persisted held-input state allows a restarted broker to release keys
it had pressed. Provider restore/fork MUST call host rebind before giving clients
access: a process cannot detect a memory clone without the host lifecycle signal.
Never bake running grants or recorders into a template. Old grants do not survive
a cold broker restart. No cloud provider credentials are read by Opcode.

## Provider qualification

Boat: discover its existing X display, authority path and UID; keep its existing
viewer attached to that same display. boxd: start its provider-managed Xpra desktop
first, then validate root capture against its viewer. E2B: use an existing desktop
capable template, not a plain code sandbox and not a convenience allocator.
In each case supply a new host generation on cold start/restore/fork, and keep
provider-console input out of band or disable it while Opcode owns input.

These are integration recipes, not certifications. No live Boat, boxd or E2B
workspace has been tested in this change. Do not claim same-display compatibility
until the cross-app/recording/takeover suite passes on each authorized image.
