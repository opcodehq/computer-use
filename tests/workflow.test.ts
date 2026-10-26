import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowStore } from "../src/workflow/runtime.js";
import type { WorkflowDriver } from "../src/workflow/contracts.js";
const target = { name: "Save", match: "exact" as const };
const read = {
  version: 1,
  id: "reader",
  description: "Read fixture",
  scope: { route: "browser", origin: "https://fixture.test" },
  effect: "read",
  inputs: {},
  outputs: ["result"],
  steps: [
    { kind: "extract", target, output: "result", field: "name" },
    { kind: "assert", condition: { target } },
  ],
};
const signal = new AbortController().signal;
async function fixture(run: (store: WorkflowStore) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "cu-workflow-"));
  try {
    await run(new WorkflowStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const driver: WorkflowDriver = {
  observe: async () => ({
    id: "fresh",
    url: "https://fixture.test/",
    nodes: [
      { ref: "new", name: "Save", role: "button", value: "", enabled: true },
    ],
  }),
  action: async () => {},
};
test("validation promotes a static read and preserves immutable revision integrity", () =>
  fixture(async (store) => {
    const registered = await store.register(read);
    assert.equal((await store.find()).length, 0);
    const result = await store.run(read.id, registered.revision, {}, driver, {
      signal,
      effect: "read",
      validate: true,
    });
    assert.equal(result.status, "passed");
    assert.equal(result.outputs.result, "Save");
    assert.equal((await store.find()).length, 1);
    await store.retire(read.id, registered.revision);
    await assert.rejects(
      store.run(read.id, registered.revision, {}, driver, {
        signal,
        effect: "read",
      }),
      /not validated/,
    );
  }));
test("scope mismatch and ambiguous targets cannot dispatch", () =>
  fixture(async (store) => {
    const w = {
      ...read,
      id: "writer",
      effect: "write",
      outputs: [],
      steps: [
        { kind: "action", target, operation: "press", commit: true },
        { kind: "assert", condition: { target } },
      ],
    };
    const r = await store.register(w);
    let calls = 0;
    const wrong: WorkflowDriver = {
      ...driver,
      observe: async () => ({ id: "x", url: "https://other.test", nodes: [] }),
      action: async () => {
        calls++;
      },
    };
    const result = await store.run(w.id, r.revision, {}, wrong, {
      signal,
      effect: "write",
      validate: true,
    });
    assert.equal(result.status, "failed");
    assert.equal(calls, 0);
  }));
test("commit receipt survives failed dispatch and no match cannot be asserted from a truncated tree", () =>
  fixture(async (store) => {
    const w = {
      ...read,
      id: "writer",
      effect: "write",
      outputs: [],
      steps: [
        { kind: "action", target, operation: "press", commit: true },
        { kind: "assert", condition: { target } },
      ],
    };
    const r = await store.register(w);
    const result = await store.run(
      w.id,
      r.revision,
      {},
      {
        ...driver,
        action: async () => {
          throw new Error("lost receipt");
        },
      },
      { signal, effect: "write", validate: true },
    );
    assert.equal(result.status, "uncertain");
    assert.equal((await store.receipt(result.id)).dispatch, "possible");
    await assert.rejects(
      store.run(w.id, r.revision, {}, driver, {
        signal,
        effect: "write",
        validate: true,
      }),
      /requires reconciliation/,
    );
    const reconciled = await store.reconcile(result.id, {}, driver, signal);
    assert.equal(reconciled.dispatch, "verified");
    const empty = {
      ...read,
      id: "empty",
      outputs: [],
      steps: [{ kind: "assert", condition: { target, absent: true } }],
    };
    const e = await store.register(empty);
    const absent = await store.run(
      empty.id,
      e.revision,
      {},
      {
        ...driver,
        observe: async () => ({
          id: "x",
          url: "https://fixture.test",
          nodes: [],
          truncated: true,
        }),
      },
      { signal, effect: "read", validate: true, noMatch: true },
    );
    assert.equal(absent.status, "failed");
  }));
test("invalid final assertions and invocation inputs are rejected before execution", () =>
  fixture(async (store) => {
    await assert.rejects(
      store.register({
        ...read,
        steps: [{ kind: "action", operation: "press", target }],
      }),
    );
    const r = await store.register(read);
    await assert.rejects(
      store.run(read.id, r.revision, { unknown: "x" }, driver, {
        signal,
        effect: "read",
        validate: true,
      }),
      /Unknown/,
    );
  }));

test("missing optional evidence cannot turn into an unconstrained assertion", () =>
  fixture(async (store) => {
    const w = {
      ...read,
      id: "optional-proof",
      outputs: [],
      inputs: { proof: { required: false } },
      steps: [
        { kind: "assert", condition: { target, value: { input: "proof" } } },
      ],
    };
    const record = await store.register(w);
    const result = await store.run(w.id, record.revision, {}, driver, {
      signal,
      effect: "read",
      validate: true,
    });
    assert.equal(result.status, "failed");
  }));
test("bounded loops stop and matched HTTP acceleration falls back to UI on failure", () =>
  fixture(async (store) => {
    const looping = {
      ...read,
      id: "looping",
      outputs: [],
      steps: [
        {
          kind: "repeat",
          condition: { target },
          steps: [{ kind: "assert", condition: { target } }],
          maxIterations: 2,
        },
        { kind: "assert", condition: { target } },
      ],
    };
    const loop = await store.register(looping);
    assert.equal(
      (
        await store.run(looping.id, loop.revision, {}, driver, {
          signal,
          effect: "read",
          validate: true,
        })
      ).status,
      "failed",
    );
    const fast = {
      ...read,
      id: "http-read",
      http: { path: "/data", query: {}, fields: { result: ["result"] } },
    };
    const record = await store.register(fast);
    let requests = 0;
    const http = {
      ...driver,
      http: async () => {
        requests++;
        return { result: "Save" };
      },
    };
    await store.run(fast.id, record.revision, {}, http, {
      signal,
      effect: "read",
      validate: true,
    });
    const passed = await store.run(fast.id, record.revision, {}, http, {
      signal,
      effect: "read",
      execution: "best",
    });
    assert.equal(passed.status, "passed");
    assert.equal(passed.completed, 0);
    assert.equal(requests, 2);
    const fallback = await store.run(
      fast.id,
      record.revision,
      {},
      {
        ...driver,
        http: async () => {
          throw Error("network");
        },
      },
      { signal, effect: "read", execution: "best" },
    );
    assert.equal(fallback.status, "passed");
    assert.equal(fallback.completed, 2);
  }));
