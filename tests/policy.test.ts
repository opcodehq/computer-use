import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunGate, validateCandidate } from '../src/main/policy.js';
import type { Candidate, Snapshot } from '../src/shared/contracts.js';

const snapshot: Snapshot = { id: 's1', source: 'ax', pid: 10, title: 'Test', truncated: false, nodes: [
  { ref: 's1:1', role: 'AXButton', name: 'Save', value: '', enabled: true, actions: ['AXPress'], depth: 1 },
  { ref: 's1:2', role: 'AXTextField', name: 'Name', value: '', enabled: true, actions: ['setValue'], depth: 1 },
] };
const press: Candidate = { id: 'a1', description: 'Save', action: { kind: 'press', ref: 's1:1' } };
test('accepts grounded action but rejects invented and disabled targets', () => {
  assert.doesNotThrow(() => validateCandidate(press, snapshot, false));
  assert.throws(() => validateCandidate({ ...press, action: { kind: 'press', ref: 's0:1' } }, snapshot, false));
  assert.throws(() => validateCandidate(press, { ...snapshot, nodes: snapshot.nodes.map(n => ({ ...n, enabled: false })) }, false));
});
test('rejects unsupported field writes and protected fields', () => {
  const edit: Candidate = { id: 'a', description: 'Type', action: { kind: 'setValue', ref: 's1:1', text: 'hello' } };
  assert.throws(() => validateCandidate(edit, snapshot, false));
  assert.throws(() => validateCandidate({ ...edit, action: { ...edit.action, ref: 's1:2' } }, { ...snapshot, nodes: snapshot.nodes.map(n => ({ ...n, value: '[secure]' })) }, false));
});
test('pixel actions require visual evidence and finite coordinates', () => {
  const click: Candidate = { id: 'a', description: 'Click', action: { kind: 'click', x: 1, y: 2 } };
  assert.throws(() => validateCandidate(click, snapshot, false));
  assert.throws(() => validateCandidate({ ...click, action: { kind: 'click', x: NaN, y: 2 } }, snapshot, true));
  assert.doesNotThrow(() => validateCandidate(click, snapshot, true));
});
test('browser navigation rejects script/file URLs and native route', () => {
  for (const text of ['javascript:alert(1)', 'file:///etc/passwd', 'not a URL']) {
    assert.throws(() => validateCandidate({ id: 'a', description: 'Navigate', action: { kind: 'navigate', text } }, { ...snapshot, source: 'dom' }, false));
  }
  assert.throws(() => validateCandidate({ id: 'a', description: 'Navigate', action: { kind: 'navigate', text: 'https://example.com' } }, snapshot, false));
});
test('Stop revokes old dispatch even after another run begins', () => {
  const gate = new RunGate();
  const old = gate.begin(); gate.assert(old); gate.stop();
  assert.throws(() => gate.assert(old));
  const next = gate.begin(); gate.finish(old); gate.assert(next);
  assert.throws(() => gate.assert(old));
});
