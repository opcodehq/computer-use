import { test } from "node:test";
import assert from "node:assert/strict";
import { codexPomeradoProvider } from "../src/harness/pomerado.js";
test("Pomerado provider translates native patch calls and only returns new correlated results", async () => {
  const requests: any[] = [];
  let calls = 0;
  const provider = codexPomeradoProvider(undefined, () => ({
    close() {},
    async next(request) {
      requests.push(request);
      calls++;
      return calls === 1
        ? {
            type: "tool",
            id: "patch-one",
            name: "cu_pomerado_patch",
            arguments: JSON.stringify({
              operation: {
                type: "create_file",
                path: "src/tool.mjs",
                diff: "+fixture",
              },
            }),
          }
        : { type: "message", text: "{}" };
    },
  }));
  const model = provider.getModel("fixture-model");
  const request = {
    input: [],
    tools: [{ type: "apply_patch", name: "apply_patch" }],
    modelSettings: {},
    outputType: { type: "json_schema", schema: { type: "object" } },
  };
  try {
    const response = await model.getResponse(request);
    assert.equal(response.output[0].type, "apply_patch_call");
    assert.equal(response.output[0].operation.path, "src/tool.mjs");
    const next = {
      ...request,
      input: [
        {
          type: "apply_patch_call_output",
          callId: "patch-one",
          status: "completed",
          output: "applied",
        },
      ],
    };
    await model.getResponse(next);
    assert.deepEqual(requests[1].results, [
      { id: "patch-one", output: "applied" },
    ]);
    assert.deepEqual(requests[1].outputSchema, { type: "object" });
    await model.getResponse(next);
    assert.equal(requests[2].results, undefined);
  } finally {
    provider.close();
  }
});
test("unsupported API prewarming and imported compaction fail before starting a harness", async () => {
  let started = 0;
  const provider = codexPomeradoProvider(undefined, () => {
    started++;
    throw Error("must not start");
  });
  const model = provider.getModel("fixture-model");
  await assert.rejects(
    model.getResponse({
      modelSettings: {
        providerData: { prompt_cache_options: { prewarm: true } },
      },
      tools: [],
      input: [],
    }),
    /prewarming/,
  );
  await assert.rejects(
    model.getResponse({
      modelSettings: {},
      tools: [],
      input: [{ type: "compaction" }],
    }),
    /compaction/,
  );
  assert.equal(started, 0);
  provider.close();
});
