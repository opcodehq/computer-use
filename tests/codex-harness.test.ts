import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CodexClient, CodexConversation } from "../src/harness/codex.js";
test("Codex bridge holds a dynamic tool RPC until upstream returns its correlated result", async () => {
  const conversation = new CodexConversation(
    new CodexClient(process.execPath, [
      resolve("tests/fixtures/codex-rpc.mjs"),
    ]),
    "fixture-model",
  );
  try {
    const request = {
      instructions: "Only fixture tools",
      input: "read fixture",
      tools: [
        {
          name: "read_fixture",
          description: "read",
          inputSchema: { type: "object" },
        },
      ],
    };
    const call = await conversation.next(request);
    assert.equal(call.type, "tool");
    if (call.type !== "tool") return;
    assert.equal(call.id, "call-one");
    const result = await conversation.next({
      ...request,
      results: [{ id: call.id, output: "persisted result" }],
    });
    assert.deepEqual(result, { type: "message", text: "verified result" });
    await assert.rejects(
      conversation.next({ ...request, tools: [] }),
      /catalog changed/,
    );
  } finally {
    conversation.close();
  }
});
