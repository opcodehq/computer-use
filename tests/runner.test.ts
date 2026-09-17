import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { DesktopDriver, DriverError } from '../src/main/driver.js';
import { DecisionModel } from '../src/main/models.js';
import { TaskRunner, runnerLayer } from '../src/main/runner.js';
import type { Event, Proposal, Start } from '../src/shared/contracts.js';

const input: Start = { goal: 'press test', mode: 'desktop', pid: 12, vision: false, autoActions: true };
const snapshot = { id: 's', source: 'ax', pid: 12, title: 'Fixture', truncated: false, nodes: [{ ref: 's:1', role: 'AXButton', name: 'Test', value: '', enabled: true, actions: ['AXPress'], depth: 0 }] };
const act: Proposal = { status: 'act', explanation: 'Press test', candidates: [{ id: 'a', description: 'Press test', action: { kind: 'press', ref: 's:1' } }] };

function fixture(options: { propose?: () => Promise<Proposal>; execute?: () => Effect.Effect<unknown, DriverError>; verify?: number } = {}) {
  let dispatches = 0;
  const events: Event[] = [];
  const services = Layer.mergeAll(
    Layer.succeed(DesktopDriver, { request: method => {
      if (method === 'snapshot') return Effect.succeed(snapshot);
      if (method === 'execute') { dispatches++; return options.execute?.() ?? Effect.succeed({ delivery: 'dispatchedUnverified' }); }
      return Effect.succeed({});
    } }),
    Layer.succeed(DecisionModel, {
      propose: () => options.propose ? Effect.promise(options.propose) : Effect.succeed(act),
      choose: () => Effect.succeed('a'), verify: () => Effect.succeed(options.verify ?? 1),
    }),
  );
  const runtime = ManagedRuntime.make(runnerLayer(e => events.push(e)).pipe(Layer.provideMerge(services)));
  return { runtime, events, dispatches: () => dispatches };
}

test('late model response cannot dispatch after synchronous revocation', async () => {
  let resolve!: (proposal: Proposal) => void;
  let requested!: () => void;
  const started = new Promise<void>(r => { requested = r; });
  const f = fixture({ propose: () => { requested(); return new Promise(r => { resolve = r; }); } });
  try {
    const running = f.runtime.runPromise(TaskRunner.use(r => r.run(input))).catch(() => {});
    await started;
    await f.runtime.runPromise(TaskRunner.use(r => Effect.sync(r.revoke)));
    resolve(act); await running;
    assert.equal(f.dispatches(), 0);
  } finally { await f.runtime.dispose(); }
});

test('uncertain action outcomes are not automatically retried', async () => {
  const f = fixture({ execute: () => Effect.fail(new DriverError({ code: 'ActionOutcomeUnknown', message: 'Lost acknowledgment', delivery: 'unknown' })) });
  try {
    await assert.rejects(f.runtime.runPromise(TaskRunner.use(r => r.run(input))));
    assert.equal(f.dispatches(), 1);
  } finally { await f.runtime.dispose(); }
});

test('planner completion is rejected when Jev cannot verify evidence', async () => {
  const f = fixture({ propose: async () => ({ status: 'done', explanation: 'Looks done', candidates: [] }), verify: 0.2 });
  try {
    await f.runtime.runPromise(TaskRunner.use(r => r.run(input)));
    assert.equal(f.events.at(-1)?.state, 'blocked');
    assert.equal(f.dispatches(), 0);
  } finally { await f.runtime.dispose(); }
});

test('vision request does not capture when vision is disabled', async () => {
  const f = fixture({ propose: async () => ({ status: 'vision', explanation: 'Canvas needs visual evidence', candidates: [] }) });
  try {
    await f.runtime.runPromise(TaskRunner.use(r => r.run(input)));
    assert.equal(f.events.at(-1)?.state, 'blocked');
    assert.equal(f.dispatches(), 0);
  } finally { await f.runtime.dispose(); }
});
