import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Authority } from "../src/desktop/authority.js";
import { X11Backend } from "../src/desktop/backend.js";
import { DesktopController } from "../src/desktop/controller.js";
import {
  type Action,
  type Request,
  scopes,
  type Target,
} from "../src/desktop/protocol.js";

class Fixture extends X11Backend {
  delivered: Action[] = [];
  block = false;
  color = 0;
  width = 640;
  releaseCount = 0;
  failRelease = false;
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
      if (this.failRelease) throw Error("driver disconnected");
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
    const failure = assert.rejects(action, (error: unknown) => {
      assert.equal((error as { delivery: string }).delivery, "unknown");
      assert.equal((error as { code: string }).code, "outcome_unknown");
      return true;
    });
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

test("multiplayer cursors require presence scope and do not grant OS input; participant leave fences held input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-multiplayer-"));
  const backend = new Fixture("", {});
  const c = new DesktopController(backend, "one", directory);
  await c.init();
  try {
    const viewer = c.authority.issue("viewer", ["viewer-read"], 60000);
    const participant = c.authority.issue(
      "alice",
      ["viewer-read", "presence"],
      60000,
    );
    const controller = c.authority.issue("bob", [...scopes], 60000);
    await assert.rejects(c.call(request("presence.join"), viewer), /scope/);
    const alice = (await c.call(
      request("presence.join", { name: "Alice", role: "human" }),
      participant,
    )) as { id: string };
    await assert.rejects(
      c.call(request("takeover", { participantId: alice.id }), participant),
      /scope/,
    );
    await assert.rejects(
      c.call(request("takeover", { participantId: alice.id }), controller),
      /another credential/,
    );
    const bob = (await c.call(
      request("presence.join", { name: "Bob" }),
      controller,
    )) as { id: string };
    const lease = (await c.call(
      request("takeover", { participantId: bob.id }),
      controller,
    )) as { id: string };
    const observation = await c.observe(controller, { kind: "display" });
    await c.call(
      request("input", {
        leaseId: lease.id,
        observationId: observation.observationId,
        action: { kind: "keyDown", key: "Shift" },
      }),
      controller,
    );
    await c.call(
      request("presence.leave", { participantId: alice.id }),
      participant,
    );
    assert.equal(c.multiplayerState().controller?.participantId, bob.id);
    await c.call(
      request("presence.leave", { participantId: bob.id }),
      controller,
    );
    assert.equal(c.multiplayerState().controller, null);
    assert.equal(backend.releaseCount, 1);
    await assert.rejects(
      c.call(request("renew", { leaseId: lease.id }), controller),
      /Acquire/,
    );
    c.authority.revoke(controller.id);
    await assert.rejects(
      c.call(request("presence.join"), controller),
      /revoked/,
    );
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("revocation and rebind remove multiplayer identities and invalidate participant-bound leases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-multiplayer-"));
  const c = new DesktopController(new Fixture("", {}), "one", directory);
  await c.init();
  try {
    const host = c.authority.issue("host", [...scopes], 60000);
    const guest = c.authority.issue("guest", [...scopes], 60000);
    const participant = (await c.call(request("presence.join"), guest)) as {
      id: string;
    };
    await c.call(request("takeover", { participantId: participant.id }), guest);
    await c.call(request("revoke", { id: guest.id }), host, true);
    assert.deepEqual(c.multiplayerState(), {
      participants: [],
      controller: null,
    });
    await c.call(request("presence.join"), host);
    await c.call(request("rebind", { generation: "two" }), host, true);
    assert.deepEqual(c.multiplayerState(), {
      participants: [],
      controller: null,
    });
    await assert.rejects(c.call(request("presence.join"), host), /rebind/);
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a busy observer cannot evict another participant's actionable observation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-multiplayer-"));
  const backend = new Fixture("", {});
  const c = new DesktopController(backend, "one", directory);
  await c.init();
  try {
    const agent = c.authority.issue("agent", [...scopes], 60000);
    const viewer = c.authority.issue("viewer", ["viewer-read"], 60000);
    const lease = (await c.call(request("acquire"), agent)) as { id: string };
    const observation = await c.observe(agent, { kind: "display" });
    for (let i = 0; i < 40; i++) await c.observe(viewer, { kind: "display" });
    await c.call(
      request("input", {
        leaseId: lease.id,
        observationId: observation.observationId,
        action: { kind: "click", x: 1, y: 1 },
      }),
      agent,
    );
    assert.equal(backend.delivered.length, 1);
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed key release remains journaled and blocks acquisition until restart cleanup succeeds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-recovery-"));
  const backend = new Fixture("", {});
  const controller = new DesktopController(backend, "one", directory);
  await controller.init();
  try {
    const grant = controller.authority.issue("agent", [...scopes], 60000);
    const lease = (await controller.call(request("acquire"), grant)) as {
      id: string;
    };
    const observation = await controller.observe(grant, { kind: "display" });
    await controller.call(
      request("input", {
        leaseId: lease.id,
        observationId: observation.observationId,
        action: { kind: "keyDown", key: "Shift" },
      }),
      grant,
    );
    backend.failRelease = true;
    await assert.rejects(
      controller.call(request("stop"), grant),
      /could not be released/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "held-input.json"), "utf8"))
        .keys,
      ["Shift"],
    );
    await assert.rejects(
      controller.call(request("takeover"), grant),
      /transition/,
    );
    await controller.close();
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "held-input.json"), "utf8"))
        .keys,
      ["Shift"],
    );
    const recoveredBackend = new Fixture("", {});
    const recovered = new DesktopController(recoveredBackend, "two", directory);
    try {
      await recovered.init();
      assert.equal(recoveredBackend.releaseCount, 1);
      assert.deepEqual(
        JSON.parse(await readFile(join(directory, "held-input.json"), "utf8"))
          .keys,
        [],
      );
    } finally {
      await recovered.close();
    }
  } finally {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("transient shortcuts and clicks preserve preexisting held input until explicit release or takeover", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opcode-held-input-"));
  const backend = new Fixture("", {});
  const c = new DesktopController(backend, "one", directory);
  await c.init();
  try {
    const grant = c.authority.issue("agent", [...scopes], 60000);
    const human = c.authority.issue("human", [...scopes], 60000);
    const lease = (await c.call(request("acquire"), grant)) as { id: string };
    const input = async (action: Action) => {
      const observation = await c.observe(grant, { kind: "display" });
      await c.call(
        request("input", {
          leaseId: lease.id,
          observationId: observation.observationId,
          action,
        }),
        grant,
      );
    };
    const held = async () =>
      JSON.parse(await readFile(join(directory, "held-input.json"), "utf8"));
    await input({ kind: "keyDown", key: "Control" });
    await input({ kind: "buttonDown", button: 1 });
    await input({ kind: "key", key: "Control+a" });
    await input({ kind: "text", text: "hello", pasteKey: "Control+v" });
    await input({ kind: "click", x: 1, y: 1 });
    assert.deepEqual(await held(), { keys: ["Control"], buttons: [1] });
    await input({ kind: "keyUp", key: "Control" });
    await input({ kind: "buttonUp", button: 1 });
    assert.deepEqual(await held(), { keys: [], buttons: [] });
    await input({ kind: "keyDown", key: "Control" });
    await input({ kind: "buttonDown", button: 1 });
    await input({ kind: "key", key: "Control+a" });
    await input({ kind: "click", x: 1, y: 1 });
    await c.call(request("takeover"), human);
    assert.equal(backend.releaseCount, 2);
    assert.equal(
      backend.delivered.filter((action) => action.kind === "buttonUp").length,
      2,
    );
    assert.deepEqual(await held(), { keys: [], buttons: [] });
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});
