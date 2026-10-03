import { Recorder } from "../src/desktop/recording.ts";
import { ppmToPNG } from "../src/linux/capture.ts";
import { mkdtemp, readFile, readdir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const directory = await mkdtemp(
  join(process.cwd(), ".context/recording-failures-"),
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = async () => ({
  geometry: { width: 640, height: 480 },
  png: ppmToPNG(
    Buffer.concat([
      Buffer.from("P6\n640 480\n255\n"),
      randomBytes(640 * 480 * 3),
    ]),
  ),
});
const recorder = new Recorder(directory, frame);
await recorder.init();
try {
  const limited = await recorder.start(
    "one",
    { kind: "display" },
    { fps: 10, maxBytes: 1000000, maxSeconds: 10 },
  );
  for (
    let i = 0;
    i < 100 && ["recording", "paused"].includes(recorder.get(limited.id).state);
    i++
  )
    await wait(100);
  const quota = recorder.get(limited.id);
  assert(["failed", "completed"].includes(quota.state));
  assert(quota.bytes <= 1000000, "Recording exceeded its byte limit");
  await recorder.stop(limited.id);
  const killed = await recorder.start(
    "one",
    { kind: "display" },
    { fps: 5, maxBytes: 20000000, maxSeconds: 10 },
  );
  await wait(1300);
  let pid;
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const status = await readFile("/proc/" + name + "/status", "utf8");
      if (!new RegExp("PPid:\\s+" + process.pid + "\\n").test(status)) continue;
      const executable = await readlink("/proc/" + name + "/exe");
      if (executable === process.env.CU_FFMPEG) {
        pid = Number(name);
        break;
      }
    } catch {}
  }
  assert(pid, "Find this test’s encoder process");
  process.kill(pid, "SIGKILL");
  for (let i = 0; i < 30 && recorder.get(killed.id).state === "recording"; i++)
    await wait(100);
  assert.equal(recorder.get(killed.id).state, "failed");
  const restarted = new Recorder(directory, frame);
  await restarted.init();
  assert.equal(restarted.get(killed.id).state, "failed");
  const duration = await recorder.start(
    "one",
    { kind: "display" },
    { fps: 5, maxBytes: 20000000, maxSeconds: 1 },
  );
  for (
    let i = 0;
    i < 40 && recorder.get(duration.id).state === "recording";
    i++
  )
    await wait(100);
  assert.equal(recorder.get(duration.id).state, "completed");
  console.log(
    "PASS recording size limit, duration limit, real encoder kill, persisted failure and restart",
  );
  console.log(directory);
} finally {
  await recorder.fence();
}
