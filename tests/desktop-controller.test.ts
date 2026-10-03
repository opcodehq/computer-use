import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DesktopController } from "../src/desktop/controller.js";
import { X11Backend } from "../src/desktop/backend.js";
import { Authority } from "../src/desktop/authority.js";
import {
  scopes,
  type Request,
  type Action,
  type Target,
} from "../src/desktop/protocol.js";
class Fixture extends X11Backend {
  delivered: Action[] = [];
  block = false;
  color = 0;
  width = 640;
  releaseCount = 0;
  override async geometry() {
    return { id: 1, x: 0, y: 0, width: this.width, height: 480 };
  }
  override async capture() {
    return {
      geometry: await this.geometry(),
      png: Buffer.from("png"),
      ppm: Buffer.from("ppm"),
      sample: Buffer.alloc(16, this.color),
    };
  }
  override async state() {
    return { focus: 1, x: 0, y: 0 };
  }
  override async input(_t: Target, a: Action, s: AbortSignal) {
    if (a.kind === "keyUp") {
      this.releaseCount++;
      return;
    }
    this.delivered.push(a);
    if (this.block)
      await new Promise<void>((_, reject) => {
        s.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        });
      });
  }
}
const request = (
  method: string,
  args: Record<string, unknown> = {},
): Request => ({ id: randomUUID(), generation: "one", method, args });
test("grants are scoped, expiring, revocable and invalid after rebind", () => {
  let now = 10;
  const auth = new Authority("one", () => now);
  const g = auth.issue("viewer", ["viewer-read"], 1000);
  assert.throws(() => auth.verify(g.token, "input-control"), /scope/);
  now = 1011;
  assert.throws(() => auth.verify(g.token), /expired/);
  const newer = auth.issue("a", ["observe"], 1000);
  auth.rebind("two");
  assert.throws(() => auth.verify(newer.token), /invalid/);
});
test("one controller, takeover cancels queued input and releases held keys; fresh observation required", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-controller-")),
    backend = new Fixture("", {}),
    c = new DesktopController(backend, "one", directory);
  await c.init();
  try {
    const a = c.authority.issue("agent", [...scopes], 60000),
      b = c.authority.issue("human", [...scopes], 60000);
    const lease = (await c.call(request("acquire"), a)) as { id: string };
    await assert.rejects(c.call(request("acquire"), b), /controller/);
    const obs = await c.observe(a, { kind: "display" });
    backend.block = true;
    const action = c.call(
      request("input", {
        leaseId: lease.id,
        observationId: obs.observationId,
        action: { kind: "keyDown", key: "Shift" },
      }),
      a,
    );
    const failure = assert.rejects(action, /may have been delivered/);
    await new Promise((r) => setTimeout(r, 10));
    const queued = c.call(
      request("input", {
        leaseId: lease.id,
        observationId: obs.observationId,
        action: { kind: "click", x: 10, y: 10 },
      }),
      a,
    );
    const rejected = assert.rejects(queued, /control|Control/);
    const takeover = (await c.call(request("takeover"), b)) as { id: string };
    await Promise.all([failure, rejected]);
    assert.equal(backend.delivered.length, 1);
    assert.equal(backend.releaseCount, 1);
    await assert.rejects(
      c.call(
        request("input", {
          leaseId: takeover.id,
          observationId: obs.observationId,
          action: { kind: "click", x: 10, y: 10 },
        }),
        b,
      ),
      /Observe/,
    );
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("duplicate mutations do not replay; changed pixels, geometry and generation reject input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-controller-")),
    backend = new Fixture("", {}),
    c = new DesktopController(backend, "one", directory);
  await c.init();
  try {
    const a = c.authority.issue("agent", [...scopes], 60000);
    const lease = (await c.call(request("acquire"), a)) as { id: string };
    const obs = await c.observe(a, { kind: "display" });
    const r = request("input", {
      leaseId: lease.id,
      observationId: obs.observationId,
      action: { kind: "click", x: 10, y: 10 },
    });
    await c.call(r, a);
    await c.call(r, a);
    assert.equal(backend.delivered.length, 1);
    const next = await c.observe(a, { kind: "display" });
    backend.color = 100;
    await assert.rejects(
      c.call(
        request("input", {
          leaseId: lease.id,
          observationId: next.observationId,
          action: { kind: "click", x: 10, y: 10 },
        }),
        a,
      ),
      /changed/,
    );
    await assert.rejects(
      c.call({ ...request("observe"), generation: "old" }, a),
      /rebind/,
    );
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});
