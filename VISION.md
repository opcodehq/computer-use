# Local vision

Jev consumes typed text decisions; it is not an image model. The native driver runs
Apple Vision OCR and an optional CoreML object detector locally. Detected regions
augment fresh Accessibility observations. Pixels stay local in Jev mode. An existing
coding harness can request `capture` to inspect the actual image with its own vision
capability when labels cannot explain an icon or canvas.

YOLO locates UI regions; it does **not** establish an icon's function, clickability,
or task completion. Accessibility semantics win when the same control is present.
Known secure fields are excluded. Every visual click binds to one captured window,
expires after 15 seconds, rechecks its pixel patch and window geometry, and uses the
same background delivery guards as native clicks. Changed targets require a fresh
observation. Dispatched input always needs fresh outcome verification.

## Install the UI detector

OCR requires no downloaded model. YOLO requires a Vision-compatible CoreML detector
with embedded NMS; generic COCO models detect everyday objects, not desktop controls.
The export script uses Microsoft's OmniParser v2 UI detector, pinned to revision
`6600256cb0f1b07651e3bc86166196307bad7e2d` and SHA-256 checked before loading.

```sh
python3 -m venv .venv/vision
.venv/vision/bin/pip install -r scripts/vision-requirements.txt
.venv/vision/bin/python scripts/export-ui-detector.py --directory .models
```

Select the resulting **absolute** `.models/model.mlpackage` path in the Electron
settings, pass `--model-path /absolute/path/model.mlpackage`, or set
`JEV_YOLO_MODEL_PATH`. The default installation path is
`~/Library/Application Support/jev-desktop/models/ui-detector.mlpackage`.
The initial model compilation may be slower; the driver caches it for the process.
A missing or invalid detector explicitly reports OCR-only fallback.

```sh
bun start observe --session visual-demo --app Safari --visual
bun start task --app Safari --visual --instruction 'Complete the supplied task'
bun start capture --session visual-demo --app Safari \
  --input-json '{"outputPath":"/tmp/jev-safari.png"}'
bun start detect_image --input-json '{"imagePath":"/tmp/jev-safari.png","overlay":true}'
```

`capture` writes a new 0600 PNG only when an explicit outputPath is supplied; without
one it returns base64. `detect_image` is offline perception, never an actionable
window observation. `--overlay` adds local green YOLO/cyan OCR boxes to preview frames.
No screenshots are automatically saved by Electron. Settings remember nonsecret
vision preferences locally; the API key continues to use the separate 0600 file.

## Model provenance and licensing

- [Microsoft OmniParser v2 model](https://huggingface.co/microsoft/OmniParser-v2.0)
- [Detector license at the pinned revision](https://huggingface.co/microsoft/OmniParser-v2.0/blob/6600256cb0f1b07651e3bc86166196307bad7e2d/icon_detect/LICENSE)
- [Ultralytics CoreML export](https://docs.ultralytics.com/integrations/coreml/)

The selected icon-detection weights and Ultralytics tooling use AGPL-3.0 licensing;
they are downloaded separately, not relicensed or checked into this repository.
Assess those terms before distributing a product with them. The runtime also accepts
an appropriately licensed compatible detector of your choice.

## Preview and isolation

The Electron workspace includes a local screenshot/semantic preview, a floating
always-on-top preview, detection overlays, and a virtual pointer tied to actual
action events. Terminal task states clear the pointer and ripple. Reduced-motion
preferences are respected. Without capture, the preview is explicitly a semantic
layout, not a screenshot.

Same-desktop background input is **not** a separate macOS GUI session. It yields while
the user is in the target app and refuses unsupported off-screen pointer delivery.
A second login/VM/remote desktop requires an actual running isolated GUI session;
this beta does not provision one or claim a second hardware cursor. The floating
preview is a view into the current selected window, not an isolation boundary.

Capture uses the exact window ID, excludes window shadows, and converts image
pixels to window points before input. These options are documented in Apple's
[SCStreamConfiguration reference](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration).
