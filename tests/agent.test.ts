import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentDecision, openAgent } from '../src/tool/agent.js';
import { acceptsTaskCompletion, runDesktopGoal } from '../src/tool/task.js';
import type { Candidate, Snapshot, Event } from '../src/shared/contracts.js';

const snapshot: Snapshot = { id: 's', source: 'ax', pid: 42, title: 'Fixture', truncated: false, nodes: [
  { ref: 's:0', name: 'Save', role: 'AXButton', value: '', enabled: true, actions: ['AXPress'], depth: 1 },
] };
const candidates: Candidate[] = [{ id: 'a0', description: 'Save', action: { kind: 'press', ref: 's:0' } }];
const adapter = (body: string, timeout = 2000) => openAgent(process.execPath, ['-e', `const {createInterface}=require('node:readline'); createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line); ${body}});`], timeout);

test('agent decisions ground targets and exact writes without accepting model confidence', () => {
  assert.equal(agentDecision({ choice: 'a0', confidence: 1 }, candidates, [], []).confidence, 0);
  assert.throws(() => agentDecision({ choice: 'stale' }, candidates, [], []), /stale/);
  const fields: Candidate[] = [{ id: 't0', description: 'Name', action: { kind: 'setValue', ref: 's:1' } }];
  assert.throws(() => agentDecision({ choice: 't0', text: 'invented' }, fields, ['Exact'], []), /textIndex/);
  for (const textIndex of [-1, 1, 0.5, '0']) assert.throws(() => agentDecision({ choice: 't0', textIndex }, fields, ['Exact'], []));
  assert.equal(agentDecision({ choice: 't0', textIndex: 0 }, fields, ['Exact'], []).text, 'Exact');
});

test('completion requires a quote grounded in the fresh screen, not history or a score', () => {
  for (const evidence of [undefined, '', '   ', 'Saved yesterday']) {
    assert.throws(() => agentDecision({ choice: 'done', confidence: 1, evidence }, [], [], ['Saved today']), /current observedText/);
  }
  const decision = agentDecision({ choice: 'done', evidence: 'Saved today' }, [], [], ['Status: Saved today']);
  assert.equal(acceptsTaskCompletion(decision), true);
  assert.equal(decision.confidence, 0);
});

test('persistent external agent runs a whole workflow with fresh observation and no TypeSafe calls', async () => {
  const agent = adapter(`const saved=request.state.observedText.some(x=>x.text==='Saved'); console.log(JSON.stringify({id:request.id,choice:saved?'done':request.state.controls.find(c=>c.description.includes('Save')).id,...(saved?{evidence:'Saved'}:{})}));`);
  let saved = false;
  const calls: string[] = []; const events: Event[] = [];
  try {
    await runDesktopGoal('Press Save and verify Saved', '42', async method => {
      calls.push(method);
      if (method === 'apps') return [{ pid: 42, name: 'Fixture' }];
      if (method === 'snapshot') return { ...snapshot, id: saved ? 's2' : 's', nodes: saved ? [{ ...snapshot.nodes[0], ref: 's2:0', name: 'Saved', role: 'AXStaticText', actions: [] }] : snapshot.nodes };
      if (method === 'execute') saved = true;
      return {};
    }, agent.decide, event => events.push(event), new AbortController().signal);
    assert.deepEqual(calls, ['apps', 'snapshot', 'execute', 'snapshot']);
    assert.equal(events.at(-1)?.state, 'succeeded');
    assert.match(events.at(-1)?.message ?? '', /Agent reported completion/);
  } finally { await agent.close(); }
});

for (const [name, body, expected] of [
  ['wrong id', `console.log(JSON.stringify({id:request.id+1,choice:'a0'}));`, /unexpected response id/],
  ['malformed JSON', `console.log('not json');`, /JSON|Unexpected/],
  ['oversized response', `console.log('x'.repeat(1_000_001));`, /exceeds 1 MB/],
  ['early exit', `process.exit(1);`, /exited/],
] as const) test(`adapter rejects ${name}`, async () => {
  const agent = adapter(body);
  try { await assert.rejects(agent.decide('Save', snapshot, candidates, []), expected); }
  finally { await agent.close(); }
});

test('Stop cancels a waiting agent and timeout bounds an unresponsive adapter', async () => {
  for (const stop of [false, true]) {
    const agent = adapter('', stop ? 2000 : 50);
    const controller = new AbortController();
    try {
      const decision = agent.decide('Save', snapshot, candidates, [], controller.signal);
      if (stop) controller.abort();
      await assert.rejects(decision, stop ? /cancelled/ : /timed out/);
    } finally { await agent.close(); }
  }
});

test('missing agent executable fails and closes without hanging', async () => {
  const agent = openAgent('/does-not-exist-opcode');
  try { await assert.rejects(agent.decide('Save', snapshot, candidates, []), /ENOENT/); }
  finally { await agent.close(); }
});

test('one external-agent session writes, saves, reopens and verifies a complete fixture workflow', async () => {
  const agent = adapter(`
    const texts=request.state.observedText.map(x=>x.text);
    const complete=texts.includes('Reopened: Opcode');
    const label=texts.includes('Saved: Opcode')?'Reopen':texts.includes('Name Opcode')?'Save':'Name';
    const control=request.state.controls.find(x=>x.description.includes(label));
    console.log(JSON.stringify(complete?{id:request.id,choice:'done',evidence:'Reopened: Opcode'}:{id:request.id,choice:control.id,...(label==='Name'?{textIndex:request.textValues.indexOf('Opcode')}:{})}));
  `);
  let stage = 0; const operations: string[] = []; const events: Event[] = [];
  try {
    await runDesktopGoal('Set name to "Opcode", save it, reopen it and verify the saved name', '42', async (method, args) => {
      if (method === 'apps') return [{ pid: 42, name: 'Fixture' }];
      if (method === 'snapshot') {
        const id = `stage${stage}`;
        const node = (name: string, role: string, actions: string[], value = '', index = 0) => ({ ref: `${id}:${index}`, name, role, value, enabled: true, focused: true, actions, depth: 1 });
        return { ...snapshot, id, nodes: stage < 2
          ? [node('Name', 'AXTextField', ['setValue'], stage === 1 ? 'Opcode' : ''), node('Save', 'AXButton', ['AXPress'], '', 1)]
          : stage === 2 ? [node('Saved: Opcode', 'AXStaticText', []), node('Reopen', 'AXButton', ['AXPress'], '', 1)]
          : [node('Reopened: Opcode', 'AXStaticText', [])] };
      }
      if (method === 'execute') {
        const action = args?.action as { kind: string; ref: string; text?: string };
        assert.equal(args?.snapshotId, `stage${stage}`);
        assert.ok(action.ref.startsWith(`stage${stage}:`));
        if (stage === 0) assert.equal(action.text, 'Opcode');
        operations.push(action.kind); stage++;
      }
      return {};
    }, agent.decide, event => events.push(event), new AbortController().signal);
    assert.deepEqual(operations, ['setValue', 'press', 'press']);
    assert.equal(stage, 3);
    assert.equal(events.at(-1)?.state, 'succeeded');
  } finally { await agent.close(); }
});
