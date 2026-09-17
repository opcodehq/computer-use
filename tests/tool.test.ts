import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopTool, type Selector } from '../src/tool/service.js';
const snapshot = { id: 's1', source: 'ax', pid: 42, title: 'Calculator', truncated: false, nodes: [
  { ref: 's1:0', role: 'AXButton', name: '7', value: '', enabled: true, actions: ['AXPress'], depth: 1 },
] };
function fixture(select: Selector, failAfter = false) {
  const calls: string[] = [];
  const tool = new DesktopTool(async method => {
    calls.push(method);
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') { if (failAfter && calls.includes('execute')) throw new Error('Observation failed'); return snapshot; }
    if (method === 'execute') return { status: 'dispatchedUnverified' };
    throw new Error(method);
  }, select);
  return { tool, calls };
}
const input = { app: 'Calculator', instruction: 'Press 7' };
test('Jev selection dispatches exactly once and returns observed state without a planner', async () => {
  const { tool, calls } = fixture(async (_instruction, _snapshot, candidates) => {
    assert.equal(candidates[0]!.action.ref, 's1:0'); return { choice: 'a0', confidence: 0.9 };
  });
  const result = await tool.call('act', input);
  assert.equal(Reflect.get(result as object, 'status'), 'dispatchedUnverified');
  assert.deepEqual(calls, ['apps', 'snapshot', 'execute', 'snapshot']);
});
test('no-match, low confidence, invented IDs and preview never dispatch', async () => {
  for (const choice of ['none', 'invented', 'a0']) {
    const { tool, calls } = fixture(async () => ({ choice, confidence: 0.1 }));
    await tool.call('act', input); assert.ok(!calls.includes('execute'));
  }
  const { tool, calls } = fixture(async () => ({ choice: 'a0', confidence: 1 }));
  await tool.call('act', { ...input, dryRun: true }); assert.ok(!calls.includes('execute'));
});
test('cancelled selection cannot dispatch and concurrent calls cannot replace refs', async () => {
  const controller = new AbortController();
  const { tool, calls } = fixture(async () => {
    await assert.rejects(tool.call('observe', input), /busy/);
    controller.abort(); return { choice: 'a0', confidence: 1 };
  });
  await assert.rejects(tool.call('act', input, controller.signal));
  assert.ok(!calls.includes('execute'));
});
test('observation failure after dispatch is reported without replay', async () => {
  const { tool, calls } = fixture(async () => ({ choice: 'a0', confidence: 1 }), true);
  const result = await tool.call('act', input);
  assert.equal(Reflect.get(result as object, 'dispatched'), true);
  assert.equal(calls.filter(method => method === 'execute').length, 1);
});

test('uncertain native dispatch returns fresh observation without retrying', async () => {
  const calls: string[] = [];
  const tool = new DesktopTool(async method => {
    calls.push(method);
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return snapshot;
    throw Object.assign(new Error('AX action timeout'), { delivery: 'dispatchedUnverified' });
  }, async () => ({ choice: 'a0', confidence: 0.9 }));
  const result = await tool.call('act', input);
  assert.equal(Reflect.get(result as object, 'status'), 'outcomeUnknown');
  assert.deepEqual(calls, ['apps', 'snapshot', 'execute', 'snapshot']);
});

test('reasoning caller executes a fresh exact ref without another model judgment', async () => {
  const { tool, calls } = fixture(async () => { throw new Error('Must not invoke Jev'); });
  await tool.call('observe', { app: 'Calculator' });
  await tool.call('execute', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', operation: 'press' });
  assert.deepEqual(calls, ['apps', 'snapshot', 'apps', 'execute', 'snapshot']);
});

test('exact execution rejects missing observations, stale generations and invented refs', async () => {
  const { tool, calls } = fixture(async () => { throw new Error('Must not invoke Jev'); });
  const exact = { app: 'Calculator', snapshotId: 's1', ref: 's1:0', operation: 'press' };
  await assert.rejects(tool.call('execute', exact), /Stale snapshot/);
  await tool.call('observe', { app: 'Calculator' });
  await assert.rejects(tool.call('execute', { ...exact, snapshotId: 'old' }), /Stale snapshot/);
  await assert.rejects(tool.call('execute', { ...exact, ref: 'invented' }), /Ref does not support/);
  assert.ok(!calls.includes('execute'));
});

test('unknown delivery followed by failed observation invalidates exact execution', async () => {
  const { tool, calls } = fixture(async () => ({ choice: 'a0', confidence: 0.9 }), true);
  await tool.call('observe', { app: 'Calculator' });
  await tool.call('execute', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', operation: 'press' });
  await assert.rejects(tool.call('execute', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', operation: 'press' }), /Stale snapshot/);
  assert.equal(calls.filter(m => m === 'execute').length, 1);
});

test('named keyboard actions require fresh state and reject arbitrary key strings', async () => {
  const calls: { method: string; args?: Record<string, unknown> }[] = [];
  const tool = new DesktopTool(async (method, args) => {
    calls.push({ method, args });
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return snapshot;
    return { delivery: 'dispatchedUnverified' };
  }, async () => { throw new Error('Keyboard must not call Jev'); }, () => {}, 'foreground');
  await assert.rejects(tool.call('key', { app: 'Calculator', snapshotId: 's1', key: 'Escape' }), /Stale snapshot/);
  await tool.call('observe', { app: 'Calculator' });
  await assert.rejects(tool.call('key', { app: 'Calculator', snapshotId: 's1', key: 'arbitrary text' }), /Unsupported named key/);
  await tool.call('key', { app: 'Calculator', snapshotId: 's1', key: 'Escape' });
  const sent = calls.filter(c => c.method === 'execute');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.args?.action, { kind: 'key', text: 'Escape' });
});

test('pointer fallback requires observed bounds and never calls Jev', async () => {
  const { tool, calls } = fixture(async () => { throw new Error('Must not call Jev'); });
  await tool.call('observe', { app: 'Calculator' });
  await assert.rejects(tool.call('click', { app: 'Calculator', snapshotId: 's1', ref: 's1:0' }), /visible actionable ref/);
  assert.ok(!calls.includes('execute'));
});

test('exact caller can press an observed unnamed group omitted from semantic candidates', async () => {
  const calls: string[] = [];
  const tool = new DesktopTool(async method => {
    calls.push(method);
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return { ...snapshot, nodes: [{ ...snapshot.nodes[0], role: 'AXGroup', name: '' }] };
    return { delivery: 'dispatchedUnverified' };
  }, async () => { throw new Error('Must not call Jev'); });
  await tool.call('observe', { app: 'Calculator' });
  const result = await tool.call('execute', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', operation: 'press' });
  assert.equal(Reflect.get(result as object, 'selectionSource'), 'host');
  assert.equal(Reflect.get(result as object, 'stateChanged'), false);
  assert.equal(calls.filter(m => m === 'execute').length, 1);
});


test('background mode never dispatches physical input or cursor animation', async () => {
  const { tool, calls } = fixture(async () => ({ choice: 'a0', confidence: 1 }));
  await tool.call('observe', { app: 'Calculator' });
  await assert.rejects(tool.call('key', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', key: 'Enter' }), /focused control/);
  assert.ok(!calls.includes('execute'));
  let animated: unknown;
  const semantic = new DesktopTool(async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return snapshot;
    animated = args?.animate;
    return {};
  }, async () => ({ choice: 'a0', confidence: 1 }));
  await semantic.call('act', { ...input, animate: true });
  assert.equal(animated, false);
});


test('background pointer dispatch is window-routed without cursor animation or Jev inference', async () => {
  let sent: Record<string, unknown> | undefined;
  const tool = new DesktopTool(async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return { ...snapshot, nodes: [{ ...snapshot.nodes[0], frame: { x: 1, y: 2, width: 30, height: 20 } }] };
    sent = args; return {};
  }, async () => { throw new Error('Must not call Jev'); });
  await tool.call('observe', { app: 'Calculator' });
  await tool.call('click', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', animate: true });
  assert.deepEqual(sent?.action, { kind: 'backgroundClick', ref: 's1:0' });
  assert.equal(sent?.animate, false);
});


test('background text and keys require an observed focused editable ref', async () => {
  const sent: unknown[] = [];
  const tool = new DesktopTool(async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return { ...snapshot, nodes: [{ ...snapshot.nodes[0], role: 'AXTextArea', name: 'Terminal input', focused: true }] };
    sent.push(args?.action); return {};
  }, async () => { throw new Error('Exact typing must not call Jev'); });
  await tool.call('observe', { app: 'Calculator' });
  await tool.call('type', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', text: 'echo JEV_TEST' });
  await tool.call('key', { app: 'Calculator', snapshotId: 's1', ref: 's1:0', key: 'Enter' });
  assert.deepEqual(sent, [{ kind: 'backgroundText', ref: 's1:0', text: 'echo JEV_TEST' }, { kind: 'backgroundKey', ref: 's1:0', text: 'Enter' }]);
});

test('exact-line wait distinguishes typed command from output and never dispatches', async () => {
  let reads = 0; const methods: string[] = [];
  const tool = new DesktopTool(async method => {
    methods.push(method);
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    reads++;
    return { ...snapshot, nodes: [{ ...snapshot.nodes[0], name: '', value: reads === 1 ? '$ echo JEV_TEST' : '$ echo JEV_TEST\nJEV_TEST\n$' }] };
  });
  const result = await tool.call('wait', { app: 'Calculator', waitText: 'JEV_TEST', timeoutMs: 1000 });
  assert.equal(Reflect.get(result as object, 'status'), 'matched');
  assert.equal(reads, 2); assert.ok(!methods.includes('execute'));
});

test('exact window selection persists after dispatch and refuses a different requested window', async () => {
  const windows: unknown[] = [];
  const tool = new DesktopTool(async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') { windows.push(args?.windowId); return { ...snapshot, windowId: 99 }; }
    return {};
  }, async () => ({ choice: 'a0', confidence: 1 }));
  await tool.call('observe', { app: 'Calculator', windowId: 99 });
  await assert.rejects(tool.call('execute', { app: 'Calculator', windowId: 100, snapshotId: 's1', ref: 's1:0' }), /Stale snapshot/);
  await tool.call('execute', { app: 'Calculator', snapshotId: 's1', ref: 's1:0' });
  assert.deepEqual(windows, [99, 99]);
});

test('failed refresh removes refs rather than retaining an old actionable snapshot', async () => {
  let reads = 0; let dispatched = false;
  const tool = new DesktopTool(async method => {
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') { if (++reads > 1) throw new Error('App unavailable'); return snapshot; }
    dispatched = true; return {};
  });
  await tool.call('observe', { app: 'Calculator' });
  await assert.rejects(tool.call('observe', { app: 'Calculator' }), /App unavailable/);
  await assert.rejects(tool.call('execute', { app: 'Calculator', snapshotId: 's1', ref: 's1:0' }), /Stale snapshot/);
  assert.equal(dispatched, false);
});

test('selection receives recent observed outcomes and preserves distribution/timings', async () => {
  const histories: string[][] = [];
  const { tool } = fixture(async (_goal, _snapshot, _candidates, _signal, history) => {
    histories.push(history ?? []);
    return { choice: 'a0', confidence: 0.9, probabilities: { a0: 0.9, none: 0.1 } };
  });
  await tool.call('act', input);
  const result = await tool.call('act', input) as any;
  assert.deepEqual(histories[0], []);
  assert.ok(histories[1]!.some(event => JSON.parse(event).outcome === 'noObservedChange'));
  assert.ok(!histories[1]!.join('').includes('s1:0'));
  assert.deepEqual(result.selection.probabilities, { a0: 0.9, none: 0.1 });
  for (const key of ['observation', 'selection', 'dispatch', 'total']) assert.ok(result.timingMs[key] >= 0);
});

test('shortlists require fresh refs and exclude unrelated controls before selection', async () => {
  let selections = 0;
  const { tool, calls } = fixture(async (_goal, _snapshot, candidates) => {
    selections++; assert.equal(candidates.length, 1);
    return { choice: candidates[0]!.id, confidence: 1 };
  });
  await tool.call('observe', input);
  await assert.rejects(tool.call('act', { ...input, snapshotId: 'old', candidateRefs: ['s1:0'] }), /Stale/);
  await assert.rejects(tool.call('act', { ...input, snapshotId: 's1', candidateRefs: ['invented'] }), /unsupported/);
  assert.equal(selections, 0);
  await tool.call('act', { ...input, snapshotId: 's1', candidateRefs: ['s1:0'] });
  assert.equal(selections, 1); assert.equal(calls.filter(call => call === 'execute').length, 1);
});

test('postcondition checks output independently and reports preexisting evidence', async () => {
  for (const alreadyPresent of [false, true]) {
    let executed = false;
    const output = { ...snapshot.nodes[0]!, ref: 'output', role: 'AXStaticText', name: '', value: 'JEV_TEST', actions: [] };
    const tool = new DesktopTool(async method => {
      if (method === 'apps') return [{ name: 'Calculator', pid: 42 }];
      if (method === 'execute') { executed = true; return {}; }
      return { ...snapshot, nodes: [...snapshot.nodes, ...((executed || alreadyPresent) ? [output] : [])] };
    }, async () => ({ choice: 'a0', confidence: 1 }));
    const result = await tool.call('act', { ...input, expectedOutput: 'JEV_TEST' }) as any;
    assert.equal(result.status, 'dispatchedUnverified');
    assert.equal(result.verification.status, 'observed');
    assert.equal(result.verification.alreadyPresent, alreadyPresent);
  }
});

test('output-only verification rejects exact text echoed in an editable field', async () => {
  const tool = new DesktopTool(async method => method === 'apps' ? [{ name: 'Calculator', pid: 42 }] : {
    ...snapshot, nodes: [{ ...snapshot.nodes[0]!, role: 'AXTextField', value: 'JEV_TEST', actions: ['setValue'] }],
  });
  const result = await tool.call('wait', { ...input, waitText: 'JEV_TEST', timeoutMs: 0, outputOnly: true }) as any;
  assert.equal(result.status, 'notObserved');
});

test('verification waits for delayed output without redispatching', async () => {
  let executed = 0, reads = 0;
  const tool = new DesktopTool(async method => {
    if (method === 'apps') return [{ name: 'Calculator', pid: 42 }];
    if (method === 'execute') { executed++; return {}; }
    reads++;
    return { ...snapshot, nodes: [...snapshot.nodes, ...(reads >= 3 ? [{ ...snapshot.nodes[0]!, ref: 'output', role: 'AXStaticText', name: 'READY', actions: [] }] : [])] };
  }, async () => ({ choice: 'a0', confidence: 1 }));
  const result = await tool.call('act', { ...input, expectedOutput: 'READY' }) as any;
  assert.equal(result.verification.status, 'observed');
  assert.equal(executed, 1); assert.equal(reads, 3);
});

test('decision history is cleared when changing target window', async () => {
  let windowId = 1;
  const histories: string[][] = [];
  const tool = new DesktopTool(async method => method === 'apps' ? [{ name: 'Calculator', pid: 42 }] : method === 'execute' ? {} : { ...snapshot, windowId },
    async (_goal, _snapshot, _candidates, _signal, history) => { histories.push(history ?? []); return { choice: 'a0', confidence: 1 }; });
  await tool.call('act', input);
  windowId = 2;
  await tool.call('act', { ...input, windowId });
  assert.deepEqual(histories, [[], []]);
});

test('launch resolves an exact installed app and does not invoke inference or shell', async () => {
  const calls: [string, unknown][] = [];
  const tool = new DesktopTool(async (method, args) => {
    calls.push([method, args]);
    if (method === 'installedApps') return [{ id: 'test.app', name: 'Test App' }];
    if (method === 'launchApp') return { pid: 7, active: false };
    throw new Error(method);
  }, async () => { throw new Error('Model must not be called'); });
  await assert.rejects(tool.call('launch', { app: 'unknown' }), /installed name/);
  const result = await tool.call('launch', { app: 'Test App' }) as any;
  assert.equal(result.launch.active, false);
  assert.deepEqual(calls.at(-1), ['launchApp', { appId: 'test.app' }]);
});
