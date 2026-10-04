import assert from "node:assert/strict";
import { test } from "node:test";
import { MacBackend, type MacDriver } from "../src/desktop/mac-backend.js";
import { ppmToPNG } from "../src/linux/capture.js";

const geometry = { id: 7, x: -640, y: 0, width: 2, height: 2 };
function fixture() {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const replies: Record<string, unknown> = {
    desktopGeometry: geometry,
    desktopCapture: {
      geometry,
      base64: ppmToPNG(
        Buffer.concat([Buffer.from("P6\n2 2\n255\n"), Buffer.alloc(12)]),
      ).toString("base64"),
      sample: Buffer.alloc(64 * 48 * 4).toString("base64"),
    },
    installedApps: [{ id: "com.apple.TextEdit", name: "TextEdit" }],
  };
  const driver: MacDriver = {
    async request(method, args = {}) {
      calls.push({ method, args });
      return replies[method];
    },
  };
  return { backend: new MacBackend(driver), calls, replies };
}
test("Mac capture preserves point-space geometry and validates image dimensions", async () => {
  const { backend, replies } = fixture();
  const frame = await backend.capture({ kind: "display" });
  assert.deepEqual(frame.geometry, geometry);
  assert.equal(frame.sample.length, 64 * 48 * 4);
  (replies.desktopCapture as { geometry: typeof geometry }).geometry = {
    ...geometry,
    width: 4,
  };
  await assert.rejects(
    backend.capture({ kind: "display" }),
    /invalid desktop frame/,
  );
});
test("Mac actions retain target-relative coordinates and explicit foreground approval", async () => {
  const { backend, calls } = fixture();
  await backend.input(
    { kind: "window", id: 7 },
    { kind: "click", x: 1, y: 1 },
    new AbortController().signal,
  );
  assert.deepEqual(calls.at(-1), {
    method: "desktopInput",
    args: {
      target: { kind: "window", id: 7 },
      action: { kind: "click", x: 1, y: 1 },
      expectedGeometry: geometry,
      foregroundApproved: true,
    },
  });
});
test("Mac releases use display after target window disappears", async () => {
  const { backend, calls } = fixture();
  await backend.input(
    { kind: "window", id: 7 },
    { kind: "keyUp", key: "Meta" },
    new AbortController().signal,
  );
  assert.deepEqual(calls[0], {
    method: "desktopGeometry",
    args: { target: { kind: "display" } },
  });
});
test("Mac input does not dispatch an already cancelled action", async () => {
  const { backend, calls } = fixture();
  await assert.rejects(
    backend.input(
      { kind: "display" },
      { kind: "click", x: 1, y: 1 },
      AbortSignal.abort(),
    ),
  );
  assert.equal(calls.length, 0);
});
test("Mac launch accepts only installed bundle IDs and resize is explicit", async () => {
  const { backend, calls } = fixture();
  await assert.rejects(
    backend.input(
      { kind: "display" },
      { kind: "launch", appId: "bad.app" },
      new AbortController().signal,
    ),
    /Unknown installed/,
  );
  await backend.input(
    { kind: "display" },
    { kind: "launch", appId: "com.apple.TextEdit" },
    new AbortController().signal,
  );
  assert.deepEqual(calls.at(-1), {
    method: "launchApp",
    args: { appId: "com.apple.TextEdit" },
  });
  await assert.rejects(backend.resize(1000, 800), /not supported/);
  assert.equal(backend.capabilities.resize, false);
});
test("Mac unsupported held keys fail during preparation before native dispatch", async () => {
  const { backend, calls, replies } = fixture();
  replies.desktopKeys = ["a", "Meta", "Control", "Alt", "Shift", "Enter"];
  await assert.rejects(
    backend.prepareAction({ kind: "keyDown", key: "NotAKey" }),
    /Unsupported Mac key/,
  );
  await assert.rejects(
    backend.prepareAction({ kind: "key", key: "a+Enter" }),
    /Unsupported Mac key/,
  );
  await assert.rejects(
    backend.prepareAction({ kind: "keyDown", key: "Meta+a" }),
    /Unsupported Mac key/,
  );
  assert.deepEqual(
    await backend.prepareAction({ kind: "key", key: "Meta+A" }),
    { kind: "key", key: "Meta+A" },
  );
  assert.deepEqual(
    await backend.prepareAction({ kind: "keyUp", key: "Meta" }),
    { kind: "keyUp", key: "Meta" },
  );
  assert.deepEqual(calls, [{ method: "desktopKeys", args: {} }]);
});
