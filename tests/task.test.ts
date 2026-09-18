import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDesktopGoal, acceptsTaskDecision, acceptsTaskCompletion } from '../src/tool/task.js';
import type { Event } from '../src/shared/contracts.js';
test('open Granola resolves installed app without pressing Finder controls', async () => {
  const calls: string[] = []; const events: Event[] = [];
  await runDesktopGoal('open granola', 'Finder', async (method, args) => {
    calls.push(method);
    if (method === 'installedApps') return [{ id: 'test.granola', name: 'Granola' }];
    assert.equal(args?.appId, 'test.granola'); return { pid: 2, active: true };
  }, async () => { throw Error('Should not classify Finder controls'); }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(calls, ['installedApps', 'launchApp']);
  assert.equal(events.at(-1)?.state, 'succeeded');
});
test('unknown app launch cannot fall through to unrelated buttons', async () => {
  const calls: string[] = []; const events: Event[] = [];
  await runDesktopGoal('open granola', 'Finder', async method => { calls.push(method); return []; }, async () => { throw Error('Unexpected selection'); }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(calls, ['installedApps']); assert.equal(events.at(-1)?.state, 'blocked');
});
test('task observes again after a press and only then considers completion', async () => {
  const calls: string[] = []; const events: Event[] = []; let decisions = 0;
  await runDesktopGoal('Press 7', '42', async method => {
    calls.push(method);
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return { id: 's', source: 'ax', pid: 42, title: 'Calculator', truncated: false, nodes: [{ ref: 's:0', name: '7', role: 'AXButton', value: '', enabled: true, actions: ['AXPress'], depth: 1 }] };
    return {};
  }, async () => ++decisions === 1 ? { operation: 'press', target: 'a0', confidence: 1, complete: 0 } : { operation: 'done', target: 'none', confidence: 1, complete: 1 }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(calls, ['apps', 'snapshot', 'execute', 'snapshot']); assert.equal(events.at(-1)?.state, 'succeeded');
});

test('task can enter an exact recipient phrase then re-observe', async () => {
  const actions: unknown[] = []; const events: Event[] = []; let decisions = 0;
  await runDesktopGoal('Share daily notes with Legion team', '42', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Notes' }];
    if (method === 'snapshot') return { id: 's', source: 'ax', pid: 42, title: 'Share', truncated: false, nodes: [{ ref: 's:0', name: 'Recipients', role: 'AXTextField', value: '', enabled: true, actions: ['setValue'], depth: 1 }] };
    actions.push(args?.action); return {};
  }, async (_goal, _snapshot, _candidates, _history, _signal, values) => {
    assert.ok(values?.includes('Legion'));
    return ++decisions === 1 ? { operation: 'write', target: 't0', text: 'Legion', confidence: 1, complete: 0 } : { operation: 'blocked', target: 'none', confidence: 1, complete: 0 };
  }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(actions, [{ kind: 'setValue', ref: 's:0', text: 'Legion' }]);
  assert.equal(events.at(-1)?.state, 'blocked');
});
test('task refuses generated text not supplied by the caller', async () => {
  let dispatched = false;
  await runDesktopGoal('Find Legion', '42', async method => {
    if (method === 'apps') return [{ pid: 42, name: 'Notes' }];
    if (method === 'snapshot') return { id: 's', source: 'ax', pid: 42, title: 'Search', truncated: false, nodes: [{ ref: 's:0', name: 'Query', role: 'AXTextField', value: '', enabled: true, actions: ['setValue'], depth: 1 }] };
    dispatched = true; return {};
  }, async () => ({ operation: 'write', target: 't0', text: 'invented@example.com', confidence: 1, complete: 0 }), () => {}, new AbortController().signal);
  assert.equal(dispatched, false);
});

test('uncertain latest-item selection narrows through Search and supplied subject before deciding again', async () => {
  const actions: { kind: string; text?: string }[] = [];
  let decisions = 0;
  const events: Event[] = [];
  await runDesktopGoal('Share the latest daily notes with the team', '42', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Notes' }];
    if (method === 'snapshot') {
      const field = actions.length > 0;
      return { id: `s${actions.length}`, source: 'ax', pid: 42, title: 'Notes', truncated: false, nodes: [{ ref: 'target', depth: 0, role: field ? 'AXTextField' : 'AXButton', name: field ? 'Search notes' : 'Search', value: actions.length > 1 ? 'daily' : '', enabled: true, actions: field ? ['setValue'] : ['AXPress'] }] };
    }
    if (method === 'execute') actions.push(args?.action as { kind: string; text?: string });
    return {};
  }, async () => ++decisions === 1 ? { operation: 'press', target: 'none', confidence: 0.2, complete: 0 } : { operation: 'blocked', target: 'none', confidence: 1, complete: 0 }, e => events.push(e), new AbortController().signal);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]!.kind, 'press');
  assert.equal(actions[1]!.kind, 'setValue');
  assert.equal(actions[1]!.text, 'daily');
  assert.equal(decisions, 2);
  assert.equal(events.at(-1)?.state, 'blocked');
});

test('task focuses an unfocused web field and uses a fresh ref for its write', async () => {
  const actions: unknown[] = []; let count = 0;
  await runDesktopGoal('Set Description to "Zuse"', 'Safari', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Safari' }];
    if (method === 'snapshot') return { id: `s${count}`, source: 'ax', pid: 42, title: 'Form', truncated: false, nodes: [{ ref: `s${count}:0`, role: 'AXTextField', name: 'Description', value: count === 2 ? 'Zuse' : '', focused: count > 0, enabled: true, depth: 1, actions: ['AXPress','setValue'] }] };
    actions.push(args?.action); count++; return {};
  }, async () => count === 2 ? { operation: 'done', target: 'none', confidence: 1, complete: 1 } : { operation: 'write', target: 't0', text: 'Zuse', confidence: 1, complete: 0 }, () => {}, new AbortController().signal);
  assert.deepEqual(actions, [{ kind: 'press', ref: 's0:0' }, { kind: 'setValue', ref: 's1:0', text: 'Zuse' }]);
});

test('task waits through server processing without repeating a submission', async () => {
  let observations = 0, decisions = 0, actions = 0;
  await runDesktopGoal('Register item', 'Safari', async method => {
    if (method === 'apps') return [{ pid: 42, name: 'Safari' }];
    if (method === 'snapshot') {
      observations++;
      return { id: `s${observations}`, source: 'ax', pid: 42, title: 'Form', truncated: false, nodes: [{ ref: `s${observations}:0`, role: 'AXButton', name: observations === 2 ? 'Processing' : 'Register', value: '', enabled: observations !== 2, depth: 1, actions: ['AXPress'] }] };
    }
    actions++; return {};
  }, async () => ++decisions === 1 ? { operation: 'press', target: 'a0', confidence: 1, complete: 0 } : { operation: 'done', target: 'none', confidence: 1, complete: 1 }, () => {}, new AbortController().signal);
  assert.equal(observations, 3); assert.equal(actions, 1); assert.equal(decisions, 2);
});

test('separate navigation evidence never authorizes uncertain submissions or writes', () => {
  const base = { operation: 'press', target: 'x', confidence: 0.4, complete: 0, navigationSupport: 0.99 };
  for (const action of [{ kind: 'press' as const, ref: 's:0' }, { kind: 'backgroundKey' as const, ref: 's:0', text: 'Enter' }, { kind: 'setValue' as const, ref: 's:0', text: 'new' }]) {
    assert.equal(acceptsTaskDecision(base, [{ id: 'x', description: 'Save', action }]), false);
  }
  const options = [{ id: 'x', description: 'Focus dialog', action: { kind: 'focus' as const, ref: 's:0' } }];
  assert.equal(acceptsTaskDecision(base, options), true);
  assert.equal(acceptsTaskDecision({ ...base, navigationSupport: 0.59 }, options), false);
  assert.equal(acceptsTaskDecision({ ...base, confidence: NaN }, options), false);
  assert.equal(acceptsTaskDecision({ ...base, target: 'invented' }, options), false);
});


test('completion requires both operation agreement and fresh outcome evidence', () => {
  const decision = { operation:'done',target:'none',confidence:.95,complete:.91 };
  assert.equal(acceptsTaskCompletion(decision),true);
  for (const change of [{confidence:.89},{complete:.89},{complete:NaN},{complete:1.1},{confidence:Infinity},{operation:'press'}]) {
    assert.equal(acceptsTaskCompletion({...decision,...change}),false);
  }
});
