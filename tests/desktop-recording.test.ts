import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Recorder } from "../src/desktop/recording.js";
const frame = async () => ({
  png: Buffer.from("fixture"),
  geometry: { width: 100, height: 100 },
});
test("recording startup reports missing encoder and concurrent startup cannot spawn twice", async () => {
  const path = await mkdtemp(join(tmpdir(), "opcode-record-"));
  const recorder = new Recorder(path, frame, "/missing/ffmpeg");
  await recorder.init();
  try {
    const opts = { fps: 5, maxBytes: 1000000, maxSeconds: 3 };
    const first = recorder.start("one", { kind: "display" }, opts);
    const missing = assert.rejects(first, /ffmpeg/);
    await assert.rejects(
      recorder.start("one", { kind: "display" }, opts),
      /already active/,
    );
    await missing;
  } finally {
    await recorder.fence();
    await rm(path, { recursive: true, force: true });
  }
});
test("restart marks unfinished artifacts interrupted and paths cannot escape the store", async () => {
  const path = await mkdtemp(join(tmpdir(), "opcode-record-")),
    id = randomUUID();
  await writeFile(
    join(path, id + ".json"),
    JSON.stringify({ id, state: "recording", generation: "old" }),
  );
  const recorder = new Recorder(path, frame);
  try {
    await recorder.init();
    assert.equal(recorder.get(id).state, "interrupted");
    assert.equal(
      JSON.parse(await readFile(join(path, id + ".json"), "utf8")).state,
      "interrupted",
    );
    assert.throws(() => recorder.path("../../secrets"), /not found/);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
test("recordings reject public storage", async () => {
  const path = await mkdtemp(join(tmpdir(), "opcode-record-"));
  await chmod(path, 0o755);
  try {
    await assert.rejects(new Recorder(path, frame).init(), /private/);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
