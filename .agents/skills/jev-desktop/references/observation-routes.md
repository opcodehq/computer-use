# Reading native apps and existing browser pages

CU can read Accessibility, browser DOM, and locally detected visual regions.
Use `inspect` when the right observation route is uncertain. Reading a page URL
or an empty Accessibility tree is not proof that the page has no content.

## Automatic inspection

```sh
cu inspect --session inbox --input-json '{"app":"Aside","query":"requests"}'
```

This reads Accessibility first. Sparse/truncated content, or an absent query,
triggers local visual perception on the same selected window. `route` can be
`auto`, `ax`, `vision`, or `browser`. The result identifies the route, contains
fresh state, and explains unavailable capture. Visual results also include the same
captured image for the host agent; MCP delivers it as an image block. This is a heuristic for choosing
an observation source; the agent still verifies the user's requested outcome.
Mac screenshots require Screen Recording, including when used only for local OCR.
An attached browser page can be read without that native capture permission.

## Attach an existing Chromium/Electron browser

Use the npm `cu` launcher (Node runtime). The app must already expose a local CDP
debugging endpoint. CU does not scan ports, restart apps, enable debugging, copy
cookies, or guess which native app owns an endpoint. WebKit-only applications
without a compatible endpoint cannot use this route. Discover the app's documented
debugging support first; an app being a browser does not guarantee CDP support.

```sh
cu browser --session inbox --input-json '{"operation":"attach","endpoint":"http://127.0.0.1:9222"}'
# Select the exact returned tab ID. This is an existing logged-in page.
cu inspect --session inbox --input-json '{"pageId":"RETURNED_PAGE_ID"}'
cu browser --session inbox --input-json '{"operation":"capture","pageId":"RETURNED_PAGE_ID"}'
cu browser --session inbox --input-json '{"operation":"detach"}'
```

Attachment uses one existing context with defaults left unchanged. The selected
page and frame own the refs; native refs are not interchangeable with them.
Closing or cancelling the CU connection detaches rather than closing the user's
browser, its tabs, or its profile. An in-flight action may already have run;
observe before retrying. Explicit `closeTab` still closes its selected tab.
On attached Mac browsers, clicks and text entry use synthetic DOM events, with
unverified results. Focus-sensitive keyboard and rich pointer injection refuse;
use native semantic actions or an isolated browser for those operations.
Apps can react differently to synthetic events, so verify the page afterward.

Native tools and an owned browser remain usable under Bun. Existing-browser
attachment uses Node because the tested Bun version stalls in Playwright's CDP
WebSocket handshake. Source usage: `node dist/cli.mjs`. The npm launcher selects
Node automatically. Standalone Bun binaries do not offer this attachment route.

## Mac helper and permissions

`cu install` builds and installs:

- `~/Library/Application Support/Opcode/CU Driver.app`, bundle ID `com.opcodehq.cu.driver`.
- A checksum-pinned ONNX UI detector under `~/Library/Application Support/Opcode/models/`.
- A CLI proxy that launches the helper through LaunchServices and connects over
  an owner-only Unix socket. Each client gets separate Accessibility refs; native
  requests are serialized across clients. The helper never listens on TCP.

```sh
cu permission
cu capture-permission
cu doctor
```

Grant Accessibility and Screen Recording to **Opcode CU Driver**. The terminal
and Electron app are no longer the permission owner for this npm-installed path.
If macOS asks for a restart, finish CU runs, run `cu helper-restart`, and start a
new named session. The next native call launches the helper again. Setup does not
grant permissions programmatically and does not activate the target application.

The local detector uses ONNX Runtime plus OCR; Apple Vision OCR remains a fallback
if that worker fails. A custom Core ML detector is still accepted via `modelPath`.
See [model terms](LINUX_CLOUD.md) before redistribution; downloading weights does
not change their license. No model API key is required for local perception.

Source builds are ad-hoc signed and report that fact. A fixed path and bundle ID
provide a consistent permission owner, but do not guarantee TCC grants survive
all rebuilds. Set `CU_CODESIGN_IDENTITY` to a Developer ID identity for signed
builds. Production notarization and distributing a notarized installer still
require the publisher's Apple credentials. After a Developer ID build, run
`CU_NOTARY_PROFILE=YOUR_PROFILE bash scripts/notarize-macos-helper.sh` to submit,
staple, assess, and package the signed helper. The profile must already exist on
the release Mac; credentials are never embedded in the package.

## Validation

`bun test` covers route selection and real existing-browser attachment on Linux.
`node scripts/test-vision-worker.mjs` runs the real local model and OCR.
The Mac helper CI workflow compiles both Swift executables, installs the app,
checks LaunchServices IPC and permission ownership, and runs perception on a
fixture image without requiring desktop grants. That does not replace live
Accessibility and capture verification on a user's Mac.
