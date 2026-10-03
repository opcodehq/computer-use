import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { desktopCall } from "../src/desktop/client.js";
import { startDesktop } from "../src/desktop/server.js";

// Exercise the real authenticated HTTP server without requiring an X server.
(process.platform === "linux" ? test : test.skip)(
  "HTTP multiplayer isolates grants, publishes cursor state, and fences revoke/rebind",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "opcode-http-"));
    const helper = join(directory, "helper.cjs");
    await writeFile(
      helper,
      `#!/usr/bin/env node
const op=process.argv[2];
if(op==='display') console.log(JSON.stringify({id:1,x:0,y:0,width:2,height:2}));
else if(op==='state') console.log(JSON.stringify({focus:1,x:0,y:0}));
else if(op==='capture') process.stdout.write(Buffer.concat([Buffer.from('P6\\n2 2\\n255\\n'),Buffer.alloc(12)]));
else if(op==='list') console.log('[]');
else console.log('{}');
`,
    );
    await chmod(helper, 0o700);
    let service: Awaited<ReturnType<typeof startDesktop>> | undefined;
    try {
      service = await startDesktop({
        display: `:${100000 + Math.floor(Math.random() * 100000000)}`,
        uid: process.getuid!(),
        generation: "one",
        helper,
        directory: join(directory, "data"),
      });
      const endpoint = service.endpoint;
      const host = JSON.parse(await readFile(service.path, "utf8"))
        .token as string;
      const rpc = async (
        token: string,
        method: string,
        args: Record<string, unknown> = {},
        generation = "one",
      ) => {
        const response = await fetch(endpoint + "/rpc", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: randomUUID(), generation, method, args }),
        });
        return {
          status: response.status,
          ...((await response.json()) as {
            ok: boolean;
            result: any;
            error?: { code: string };
          }),
        };
      };
      const alice = (
        await rpc(host, "grant", {
          subject: "alice",
          scopes: ["viewer-read", "presence"],
          ttlMs: 60000,
        })
      ).result;
      const bob = (
        await rpc(host, "grant", {
          subject: "bob",
          scopes: ["viewer-read", "presence", "input-control"],
          ttlMs: 60000,
        })
      ).result;
      const anonymous = await fetch(endpoint + "/frame");
      assert.equal(anonymous.status, 403);
      const ap = (await rpc(alice.token, "presence.join", { name: "Alice" }))
        .result;
      const bp = (await rpc(bob.token, "presence.join", { name: "Bob" }))
        .result;
      assert.equal(
        (await rpc(alice.token, "takeover", { participantId: ap.id })).status,
        403,
      );
      assert.equal(
        (
          await rpc(bob.token, "presence.update", {
            participantId: ap.id,
            cursor: { x: 0.2, y: 0.3 },
          })
        ).ok,
        false,
      );
      assert.equal(
        (
          await rpc(alice.token, "presence.update", {
            participantId: ap.id,
            cursor: { x: 0.2, y: 0.3 },
          })
        ).ok,
        true,
      );
      const lease = (await rpc(bob.token, "takeover", { participantId: bp.id }))
        .result;
      assert.ok(lease.id);
      const frameResponse = await fetch(endpoint + "/frame", {
        headers: { Authorization: `Bearer ${alice.token}` },
      });
      assert.equal(frameResponse.status, 200);
      const frame = (await frameResponse.json()) as any;
      assert.equal(frame.controller.participantId, bp.id);
      assert.deepEqual(
        frame.participants.find((p: any) => p.id === ap.id).cursor,
        { x: 0.2, y: 0.3 },
      );
      assert.ok(frame.image.base64);
      assert.equal(
        (await rpc(alice.token, "state")).result.lease.subject,
        "bob",
      );
      await rpc(host, "revoke", { id: bob.id });
      const state = (await rpc(alice.token, "presence.list")).result;
      assert.equal(state.controller, null);
      assert.equal(state.participants.length, 1);
      assert.equal((await rpc(bob.token, "state")).status, 403);
      await rpc(host, "rebind", { generation: "two" });
      assert.equal((await rpc(alice.token, "state", {}, "two")).status, 403);
      assert.deepEqual((await rpc(host, "presence.list", {}, "two")).result, {
        participants: [],
        controller: null,
      });
      assert.deepEqual(
        await desktopCall(
          { endpoint, token: host, generation: "two" },
          "shutdown",
          {},
        ),
        { stopping: true },
      );
    } finally {
      await service?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
