# Add Opcode to a Zuse cloud computer

Zuse creates the cloud computer. Opcode attaches to the desktop that is already
running there, gives the agent screenshots and controls, and serves the viewer
and recordings. The agent keeps its own model and subscription.

## First integration

1. Put Opcode in the workspace image: install `@opcodehq/cu` with
   `--omit=optional`, then run `cu install --minimal`. Install FFmpeg with libx264
   if recordings are needed. The source install needs a C compiler and X11/XTest
   development headers.
2. When Zuse starts the workspace, pass its existing display and authority to
   `cu desktop-api attach`. Give it a new generation ID for this workspace start.
   Do not start a second desktop.
3. Give the agent a scoped credential file and register
   `cu desktop-api mcp --credential-file /private/agent.json` with its harness.
   The tools return real screenshots; no detector or model key is needed.
4. Route the viewer through Zuse's authenticated backend. Embed its `/view` page,
   or render `/frame` images in Zuse's own UI. Zuse checks who can see/control
   the workspace, then selects the matching scoped Opcode credential.
5. On restore or fork, call `rebind` with a new generation before allowing access.
   On workspace shutdown, call `shutdown`; the provider owns the desktop itself.

For an agent, grant `observe`, `input-control`, `viewer-read`, and `presence`
for the multiplayer MCP workflow. Recording scopes are separate. For a person
watching with a named cursor, grant `viewer-read` and `presence`; add
`input-control` only when they may take over. The `share --role agent`,
`share --role viewer`, and `share --role controller` commands create these scope
sets. Keep host/admin credentials in Zuse's backend. Grant tokens expire and can be revoked early.

The agent loop is **acquire → observe → input → observe**. Renew its lease while
working. A person taking control interrupts agent input; after control is returned,
the agent must acquire a new lease and look again before acting. An uncertain
click or text action is never automatically repeated.

The complete commands, credential format, HTTP methods, errors and limitations
are in [the service contract](DESKTOP_SERVICE.md). A host proxy example is in
[desktop-proxy.mjs](../examples/desktop-proxy.mjs). Use a stable scoped grant per
viewer session; configure the broker with the exact external viewer origin
and any proxy base path. Zuse still validates its own login on every proxy request.

## What still needs a Zuse test

Open one disposable cloud computer in Zuse. Connect Opcode to that computer and
confirm its screenshot matches the desktop Zuse shows. Then repeat for the other
providers. No one needs to paste API keys into chat.

Boat, boxd and E2B have not been live-qualified yet. The local Linux tests cover
the implementation, but cannot prove a provider image has the right X11 display,
permissions, resize support or encoder. See [validation results](DESKTOP_VALIDATION.md).
