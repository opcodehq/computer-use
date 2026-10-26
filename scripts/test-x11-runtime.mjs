#!/usr/bin/env bun
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { X11Session } from "../src/linux/x11-session.ts";
import { samplePPM } from "../src/linux/capture.ts";
const dir = await mkdtemp(join(tmpdir(), "cu-x11-runtime-"));
execFileSync("cc", [
  "tests/fixtures/desktop-scene.c",
  "-lX11",
  "-o",
  join(dir, "scene"),
]);
await writeFile(
  join(dir, "keys.c"),
  "#include <X11/Xlib.h>\n#include <X11/keysym.h>\nint main(){Display*d=XOpenDisplay(0);char keys[32];XQueryKeymap(d,keys);int k=XKeysymToKeycode(d,XK_Shift_L);XCloseDisplay(d);return (keys[k/8]>>(k%8))&1;}",
);
execFileSync("cc", [join(dir, "keys.c"), "-lX11", "-o", join(dir, "keys")]);
const xvfb = spawn(
  process.env.TEST_XVFB ?? "Xvfb",
  ["-displayfd", "3", "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
  { stdio: ["ignore", "ignore", "pipe", "pipe"] },
);
let session, app;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const number = await new Promise((r, j) => {
    let s = "";
    const t = setTimeout(() => j(Error("Display deadline")), 5000);
    xvfb.once("error", j);
    xvfb.stdio[3].on("data", (b) => {
      s += b;
      if (s.includes("\n")) {
        clearTimeout(t);
        r(s.trim());
      }
    });
  });
  const env = { ...process.env, DISPLAY: ":" + number };
  app = spawn(join(dir, "scene"), [], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let log = "";
  app.stdout.on("data", (b) => (log += b));
  session = new X11Session(resolve("native/linux/build/cu-x11"), env);
  let windows = [];
  for (let i = 0; i < 100; i++) {
    windows = JSON.parse((await session.request(["list"])).toString());
    if (windows.length) break;
    await wait(20);
  }
  assert.ok(windows.length);
  const id = String(windows[0].id);
  const full = await session.request(["frame", "root"]),
    sample = await session.request(["sample", "root"]);
  const line = full.indexOf(10),
    meta = JSON.parse(full.subarray(0, line).toString());
  assert.equal(meta.geometry.width, 1280);
  assert.deepEqual(
    sample.subarray(sample.indexOf(10) + 1),
    samplePPM(full.subarray(line + 1)),
  );
  await session.request(["focus", id]);
  await session.request(["type", id, "Unicode hello 🦊 café", "Control_L+v"]);
  for (let i = 0; i < 100 && !log.includes("Unicode hello 🦊 café"); i++)
    await wait(10);
  assert.ok(log.includes("Unicode hello 🦊 café"), log);
  await session.request(["keyDown", "root", "Shift_L"]);
  let down = false;
  try {
    execFileSync(join(dir, "keys"), [], { env });
  } catch (e) {
    assert.equal(e.status, 1);
    down = true;
  }
  assert.ok(down, "Persistent keyDown must remain held");
  session.close();
  await wait(150);
  execFileSync(join(dir, "keys"), [], { env });
  await assert.rejects(session.request(["display"]));
  console.log(
    JSON.stringify({
      status: "passed",
      frameSampleParity: true,
      unicodeClipboard: true,
      heldKeyReleaseOnDisconnect: true,
      noAutomaticReplay: true,
    }),
  );
} finally {
  session?.close();
  app?.kill("SIGTERM");
  xvfb.kill("SIGTERM");
  await rm(dir, { recursive: true, force: true });
}
