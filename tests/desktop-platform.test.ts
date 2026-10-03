import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonical,
  displayKey,
  registryPath,
} from "../src/desktop/registry.js";
import { Config, startDesktop } from "../src/desktop/server.js";
import { registryPath as x11Path } from "../src/linux/display-registry.js";

test("Mac registry is stable and separate from X11 display identities", () => {
  assert.equal(canonical("macos"), "macos");
  assert.equal(canonical("unix:01"), ":1.0");
  assert.equal(registryPath(":1"), x11Path(":1"));
  assert.equal(registryPath("macos"), registryPath("macos"));
  assert.notEqual(displayKey("macos"), displayKey(":0"));
  assert.throws(() => canonical("remote:0"));
});
test("Mac configuration needs no X11 helper and rejects arbitrary displays", () => {
  assert.equal(
    Config.parse({ display: "macos", uid: 501, generation: "test" }).helper,
    "",
  );
  assert.equal(
    Config.safeParse({ display: "evil-host:0", uid: 501, generation: "test" })
      .success,
    false,
  );
});
test("Unsupported platform fails before allocating a broker", async () => {
  const display = process.platform === "darwin" ? ":99" : "macos";
  await assert.rejects(
    startDesktop({ display, uid: process.getuid?.() ?? 0, generation: "test" }),
    (error: { code?: string }) => error.code === "unsupported",
  );
});
