# Linux cloud desktops

Run one isolated graphical display per cloud agent. The host coding agent owns the
goal, reasoning and tool loop; cu supplies screenshots, detected controls, mouse
input, typing and keys. Jev and a separate model API key are not required.

This implementation supports **Linux X11/Xvfb**. It does not control a Wayland
session. It runs inside the cloud machine, independently of the user's Mac.
Treat a VM as the isolation boundary: processes with access to the same Unix
account/display can control that desktop.

## Prepare the cloud image

Use Bun and a headed browser or other graphical application. Install these system
packages before setup:

Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install -y build-essential libx11-dev libxtst-dev xvfb
```

Amazon Linux (with Xvfb available in your image):

```sh
sudo dnf install -y gcc libX11-devel libXtst-devel
```

From this checkout:

```sh
bun install --frozen-lockfile
bun run setup:linux
bun run build
bun run desktop:linux -- bash
```

The final command creates a dedicated display and a shell inside it. Launch the
browser and your agent from that shell, so both inherit DISPLAY and
CU_LINUX_DESKTOP=1. For example:

```sh
google-chrome --no-first-run --user-data-dir=/tmp/cu-browser &
bun dist/cli.mjs doctor
bun dist/cli.mjs apps --session cloud
```

Keep the browser's sandbox enabled wherever the VM supports it. The smoke test
uses a disposable local page/profile and a sandbox-disabled browser because the
development VM does not provide Chrome's usual sandbox prerequisites.

You can pass your agent executable directly to desktop:linux instead of bash.
The agent can launch graphical applications using its existing shell tool.
The display is destroyed when the child command exits. No X11 TCP port is opened.

The Linux distribution is currently a **source checkout** with local native
dependencies. The standalone macOS installer does not install this Linux runtime.
No Python runtime is used by this path.

## Give any coding agent the tools

Run the MCP server inside that display:

```sh
bun dist/cli.mjs mcp
```

Or use the CLI with the same session name for every call:

```sh
bun dist/cli.mjs capture --session cloud --app chrome
bun dist/cli.mjs input --session cloud --app chrome \
  --snapshot-id SNAPSHOT_FROM_CAPTURE \
  --input-json '{"action":{"kind":"click","x":250,"y":350}}'
```

Capture returns the image plus snapshot. MCP returns screenshots as image content
for the host's vision model. CLI callers can use outputPath to save an owner-only
PNG and load it through the harness image tool. Raw click coordinates are relative
to that captured window, not the whole display.

Other input actions:

```json
{"action":{"kind":"type","text":"Exact text to enter"}}
{"action":{"kind":"key","text":"Control+L"}}
{"action":{"kind":"scroll","amount":3}}
```

Typing uses the **isolated display's clipboard**, replacing its prior contents.
Mouse input moves the cursor on that display. Neither touches the user's Mac.
Supported keys include Enter, Escape, Tab, Shift+Tab, arrows, Home/End, PageUp/Down,
Backspace, Space, and Control+A/L/C/V/W/T/Z. Positive scroll moves down.

Each input requires the current snapshot ID and returns a fresh observation.
Changed screens, resized windows and stale IDs refuse dispatch. Unknown delivery
requires observation before another attempt. Pause/resume and session stop also
apply to Linux input.

Use click with a detected ref when its target is unambiguous. Use input with image
coordinates when the detector missed a target. YOLO boxes are proposed regions,
not proof that a control is clickable or that an action succeeded. The host should
verify outcomes and continue the whole workflow without asking about every step.

A live HTTP viewer is available through `cu viewer --session NAME`. It supports
read-only sharing and takeover; see [workspace tools](WORKSPACE_TOOLS.md).
Embedding it in a cloud product requires that product’s authenticated port tunnel.
Do not pipe large base64 captures through a command bridge with a small output cap.

## Local vision and optional autonomous model loop

The runtime combines a pinned YOLO ONNX UI detector and local English OCR.
Setup downloads approximately 12 MB of weights and verifies SHA-256 before use.
Inference runs on CPU; screenshots are not sent to Jev. Vision-capable AI SDK
task models receive screenshot images along with candidate controls. A host
coding agent can instead use its own vision and subscription through MCP/CLI.

YOLO finds regions; it is not a planner. An existing agent or the optional task
model still supplies decisions. This does not promise unattended success on
every application, authentication challenge or ambiguous destructive operation.

The pinned conversion has no model card or explicit license declaration. The
upstream UI detector has AGPL-3.0 licensing notes; this conversion does not
establish different licensing terms. Review the model's terms before redistributing it in a commercial
image. See the existing [vision notes](../VISION.md). You may supply a compatible
one-class YOLO ONNX model through CU_YOLO_MODEL_PATH; its output must be [1,5,N]
(cx, cy, width, height, confidence) for a 640-square RGB input.

## Reproduce the real desktop test

```sh
bun run build
bun run desktop:linux -- bun scripts/test-linux-desktop.mjs
```

This opens headed Chrome, runs actual ONNX/OCR, clicks the detected input, types
and saves an exact value, navigates using the address bar, and checks the persisted
result. No browser DOM automation performs the actions. Evidence is written under
.context/linux-smoke-*/. Run this separately from the ordinary unit suite.
