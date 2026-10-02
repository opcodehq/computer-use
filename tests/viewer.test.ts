import { test } from "node:test";
import assert from "node:assert/strict";
import { DesktopViewer } from "../src/viewer/server.js";
import { DriverSession } from "../src/tool/driver-session.js";
import { ppmToPNG } from "../src/linux/capture.js";
import sharp from "sharp";
test("viewer separates read-only sharing from takeover, checks origin, and releases server", async () => {
  let binding="original";
  let paused = 0,
    resumed = 0,
    inputs = 0;
  const viewer = new DesktopViewer({
    capture: async () => Buffer.from([137, 80, 78, 71]),
    binding:()=>binding,
    pause: () => {
      paused++;
    },
    resume: async () => {
      resumed++;
    },
    input: async () => {
      inputs++;
    },
  });
  const links = await viewer.open(),
    url = new URL(links.url),
    view = new URL(links.shareUrl);
  const request = (
    path: string,
    token?: string,
    body?: unknown,
    origin?: string,
  ) =>
    fetch(url.origin + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request("state")).status, 401);
    assert.equal((await request("state", "é".repeat(64))).status, 401);
    const frame = await request("frame", view.hash.slice(1));
    assert.equal(frame.status, 200);
    const frameId = frame.headers.get("X-CU-Frame");
    assert.equal(
      (await request("takeover", view.hash.slice(1), {})).status,
      403,
    );
    assert.equal(
      (
        await request(
          "takeover",
          url.hash.slice(1),
          {},
          "https://unrelated.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("input", url.hash.slice(1), { kind: "click" })).status,
      409,
    );
    assert.equal(
      (await request("takeover", url.hash.slice(1), {})).status,
      200,
    );
    assert.equal(paused, 1);
    binding="another-window";
    assert.equal((await request('input',url.hash.slice(1),{kind:'click',frameId})).status,409);
    binding="original";

    assert.equal(
      (await request("input", url.hash.slice(1), { kind: "click", frameId }))
        .status,
      200,
    );
    assert.equal(inputs, 1);
    assert.equal((await request("resume", url.hash.slice(1), {})).status, 200);
    assert.equal(resumed, 1);
  } finally {
    await viewer.close();
  }
  await assert.rejects(fetch(url.origin + "/api/state"));
});
test("pause covers browser mutations and pointers; resume requires observation; manual input requires takeover", async () => {
  const calls: string[] = [];
  const session = new DriverSession(
    async (method, args) => {
      calls.push(method);
      return method === "browser" ? { snapshotId: "fresh" } : {};
    },
    async () => undefined,
  );
  await assert.rejects(
    session.manual(async () => {}),
    /Pause/,
  );
  await session.call("pause", {});
  await assert.rejects(
    session.call("browser", { operation: "navigate" }),
    /paused/,
  );
  await assert.rejects(session.call("pointer", {}), /paused/);
  await session.call("browser", { operation: "tabs" });
  await session.manual(async () => {
    calls.push("manual");
  });
  await session.call("resume", {});
  await assert.rejects(
    session.call("browser", { operation: "click" }),
    /Observe fresh/,
  );
  await session.call("browser", { operation: "observe" });
  await session.call("browser", { operation: "click" });
  assert.deepEqual(calls, ["browser", "manual", "browser", "browser"]);
  await session.close();
});
test("native PPM conversion produces valid PNG pixels and rejects malformed dimensions", async () => {
  const png = ppmToPNG(
    Buffer.concat([
      Buffer.from("P6\n2 1\n255\n"),
      Buffer.from([255, 0, 0, 0, 255, 0]),
    ]),
  );
  assert.deepEqual(
    [...(await sharp(png).raw().toBuffer())],
    [255, 0, 0, 0, 255, 0],
  );
  assert.throws(() => ppmToPNG(Buffer.from("P6\n2 1\n255\n")), /dimensions/);
});
