import assert from "node:assert/strict";
import { test } from "node:test";
import { Authority } from "../src/desktop/authority.js";
import { Presence } from "../src/desktop/presence.js";
import { methodArguments } from "../src/desktop/protocol.js";

test("participants are isolated by grant, bounded, and use visual-only normalized cursors", () => {
  let now = 1000;
  const authority = new Authority("one", () => now);
  const presence = new Presence(authority, () => now);
  const a = authority.issue("alice", ["presence"], 60000);
  const b = authority.issue("bob", ["presence"], 60000);
  const first = presence.join(a, "Alice", "human");
  const second = presence.join(a, "Other tab", "agent");
  assert.notEqual(first.id, second.id);
  assert.throws(
    () => presence.update(b, first.id, { x: 0.5, y: 0.5 }),
    /another credential/,
  );
  assert.throws(() => presence.leave(b, first.id), /another credential/);
  assert.throws(() =>
    methodArguments["presence.update"].parse({
      participantId: first.id,
      cursor: { x: 2, y: 0 },
    }),
  );
  const update = presence.update(a, first.id, { x: 0.5, y: 0.25 });
  assert.deepEqual(update.cursor, { x: 0.5, y: 0.25 });
  assert.throws(() => presence.update(a, first.id, null), /limited/);
  now += 100;
  assert.deepEqual(
    presence.update(a, first.id, undefined).cursor,
    update.cursor,
  );
  for (let i = 0; i < 6; i++) presence.join(a, `tab${i}`, "human");
  assert.throws(() => presence.join(a, "overflow", "human"), /limit/);
  presence.leave(a, first.id);
  assert.equal(presence.list().length, 7);
});

test("presence expires after disconnect and is removed on grant revocation and generation changes", () => {
  let now = 1000;
  const authority = new Authority("one", () => now);
  const presence = new Presence(authority, () => now);
  const grant = authority.issue("alice", ["presence"], 60000);
  const p = presence.join(grant, undefined, "human");
  now += 15001;
  assert.equal(presence.has(p.id), false);
  assert.throws(() => presence.update(grant, p.id, null), /expired/);
  presence.join(grant, undefined, "human");
  authority.revoke(grant.id);
  assert.deepEqual(presence.list(), []);
  const next = authority.issue("bob", ["presence"], 1000);
  assert.equal(presence.join(next, undefined, "human").expiresAt, now + 1000);
  authority.rebind("two");
  assert.deepEqual(presence.list(), []);
});
