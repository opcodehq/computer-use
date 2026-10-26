import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { X11Session } from "../src/linux/x11-session.js";
import { parsePPM, samplePPM, ppmToPNG } from "../src/linux/capture.js";
const helper = resolve("tests/fixtures/x11-rpc.mjs");
test("persistent native framing handles fragmented responses, unicode and serialized requests", async () => {
  const session = new X11Session(helper, process.env);
  try {
    const args = ["type", "root", "Unicode 🐈\nwith tabs\t"];
    assert.deepEqual(
      JSON.parse((await session.request(args)).toString()),
      args,
    );
    const results = await Promise.all([
      session.request(["one"]),
      session.request(["two"]),
    ]);
    assert.deepEqual(
      results.map((b) => JSON.parse(b.toString())),
      [["one"], ["two"]],
    );
    assert.equal(session.timings.length, 3);
  } finally {
    session.close();
  }
});
test("cancellation and protocol mismatch poison the session without replay", async () => {
  for (const mode of ["wait", "bad"]) {
    const session = new X11Session(helper, process.env),
      abort = new AbortController();
    const first = session.request([mode], abort.signal);
    const timer = setTimeout(() => abort.abort(), 60);
    try {
      await assert.rejects(first);
      await assert.rejects(session.request(["never-replay"]));
      assert.equal(session.timings.length, 0);
    } finally {
      clearTimeout(timer);
      session.close();
    }
  }
});
test("shared PPM parsing rejects truncation and uses the same RGB grid for validation", () => {
  const ppm = Buffer.concat([
    Buffer.from("P6\n2 1\n255\n"),
    Buffer.from([255, 0, 0, 0, 255, 0]),
  ]);
  assert.deepEqual([...samplePPM(ppm, 2, 1)], [255, 0, 0, 0, 255, 0]);
  assert.equal(parsePPM(ppm).width, 2);
  assert.equal(ppmToPNG(ppm).readUInt32BE(16), 2);
  assert.throws(() => parsePPM(ppm.subarray(0, -1)), /dimensions/);
});

test("installed apps honor XDG precedence and hidden overrides without opening X11", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { X11Backend } = await import("../src/desktop/backend.js");
  const directory = await mkdtemp(join(tmpdir(), "cu-apps-"));
  try {
    const low = join(directory, "low"),
      high = join(directory, "high"),
      user = join(directory, "user");
    for (const path of [low, high, user])
      await mkdir(join(path, "applications"), { recursive: true });
    const id = "cu-audit-fixture.desktop";
    await writeFile(
      join(low, "applications", id),
      "Type=Application\nName=Low\n",
    );
    await writeFile(
      join(high, "applications", id),
      "Type=Application\nName=High\n",
    );
    const backend = new X11Backend("unused", {
      XDG_DATA_DIRS: high + ":" + low,
      XDG_DATA_HOME: user,
    });
    assert.equal((await backend.apps()).find((a) => a.id === id)?.name, "High");
    await writeFile(join(user, "applications", id), "Hidden=true\n");
    assert.equal(
      (await backend.apps()).find((a) => a.id === id),
      undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
