import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareMenuForOpenedDocument } from '../src/tool/share-menu.js';
import { pressCandidates } from '../src/tool/candidates.js';
import { decisionState } from '../src/tool/decision-state.js';
import type { Snapshot } from '../src/shared/contracts.js';
const snapshot: Snapshot = { id: 's', source: 'ax', pid: 1, title: 'Notes', truncated: false, nodes: [
  { ref: 's:0', depth: 0, role: 'AXTextArea', name: 'Title', value: 'Daily Sep 16', enabled: true, actions: ['setValue'] },
  { ref: 's:1', depth: 0, role: 'AXPopUpButton', name: 'Share', value: '', enabled: true, actions: ['AXPress'] },
  { ref: 's:2', depth: 1, role: 'AXPopUpButton', name: 'Share', value: '', enabled: true, actions: ['AXPress'] },
  { ref: 's:3', depth: 0, role: 'AXTextArea', name: '', value: 'Long document\nbody', enabled: true, actions: ['AXPress','setValue'] },
  { ref: 's:4', depth: 1, role: 'AXStaticText', name: '', value: 'Body text', enabled: true, actions: ['AXPress'] },
] };
test('nested Share popup aliases collapse to one target, editor spans are excluded', () => {
  const candidates = pressCandidates(snapshot);
  assert.deepEqual(candidates.map(c => c.action.ref), ['s:2']);
  assert.equal(shareMenuForOpenedDocument('Share latest daily notes', snapshot, candidates, ['Pressed Daily Sep 16'])?.action.ref, 's:2');
  assert.equal(shareMenuForOpenedDocument('Share latest daily notes', snapshot, candidates, []), undefined);
  assert.equal(shareMenuForOpenedDocument('Share latest daily notes', snapshot, candidates, ['Pressed another document']), undefined);
});
test('sharing context retains the title but omits multiline document body', () => {
  const text = JSON.stringify(decisionState('Share daily notes', snapshot, pressCandidates(snapshot), []));
  assert.match(text, /Daily Sep 16/);
  assert.doesNotMatch(text, /Long document|Body text/);
});

test('adjacent same-label Share popups prefer the wider text target; distant controls stay ambiguous', () => {
  const nodes = [snapshot.nodes[0]!,
    { ...snapshot.nodes[1]!, frame: { x: 0, y: 0, width: 28, height: 28 } },
    { ...snapshot.nodes[2]!, depth: 0, frame: { x: 36, y: 0, width: 73, height: 28 } },
  ];
  const state = { ...snapshot, nodes };
  assert.equal(shareMenuForOpenedDocument('Share notes', state, pressCandidates(state), ['Pressed Daily Sep 16'])?.action.ref, 's:2');
  const distant = { ...state, nodes: [nodes[0]!, nodes[1]!, { ...nodes[2]!, frame: { x: 300, y: 0, width: 73, height: 28 } }] };
  assert.equal(shareMenuForOpenedDocument('Share notes', distant, pressCandidates(distant), ['Pressed Daily Sep 16']), undefined);
});
