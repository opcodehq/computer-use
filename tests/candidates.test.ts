import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressCandidates, textCandidates, navigationCandidates, suppliedTextOptions } from '../src/tool/candidates.js';
import type { Snapshot } from '../src/shared/contracts.js';
test('long tasks retain exact unquoted destinations and configuration identifiers', () => {
  const values = suppliedTextOptions('Configure the existing service and verify every saved field. '.repeat(6) + 'Go to https://developer.apple.com/account/resources/identifiers/list/serviceId, use com.zuse.sh.workos with auth.workos.com and https://auth.workos.com/sso/oauth/apple/ABC/callback.');
  assert.ok(values.includes('https://developer.apple.com/account/resources/identifiers/list/serviceId'));
  assert.ok(values.includes('https://auth.workos.com/sso/oauth/apple/ABC/callback'));
  assert.ok(values.includes('com.zuse.sh.workos'));
  assert.ok(values.includes('auth.workos.com'));
  assert.ok(!values.includes('https://zuse.sh'));
});
test('unnamed pressable cards carry their own descendant labels and exact refs', () => {
  const node = (ref: string, depth: number, value: string, actions: string[] = []) => ({ ref, depth, value, actions, role: actions.length ? 'AXGroup' : 'AXStaticText', name: '', enabled: true });
  const snapshot: Snapshot = { id: 's', source: 'ax', pid: 1, title: 'App', truncated: false, nodes: [node('s:0', 0, '', ['AXPress']), node('s:1', 1, 'First meeting'), node('s:2', 0, '', ['AXPress']), node('s:3', 1, 'Second meeting')] };
  const options = pressCandidates(snapshot);
  assert.match(options[0]!.description, /First meeting/);
  assert.match(options[0]!.description, /ref=s:0/);
  assert.doesNotMatch(options[0]!.description, /Second meeting/);
  assert.match(options[1]!.description, /Second meeting/);
  assert.equal(options[1]!.action.ref, 's:2');
});

test('card names ignore checkbox values and retain the actual document label', () => {
  const nodes = [
    { ref: 's:0', depth: 0, role: 'AXGroup', name: '', value: '', enabled: true, actions: ['AXPress'] },
    { ref: 's:1', depth: 1, role: 'AXGroup', name: '', value: '', enabled: true, actions: ['AXPress'] },
    { ref: 's:2', depth: 2, role: 'AXCheckBox', name: '', value: '0', enabled: true, actions: ['AXPress'] },
    { ref: 's:3', depth: 1, role: 'AXStaticText', name: '', value: 'Daily notes', enabled: true, actions: [] },
  ];
  const candidates = pressCandidates({ id: 's', source: 'ax', pid: 1, title: 'Notes', truncated: false, nodes });
  assert.match(candidates.find(c => c.action.ref === 's:0')!.description, /Daily notes/);
  assert.ok(!candidates.some(c => c.action.ref === 's:1'));
});

test('unnamed web textareas retain their own preceding heading labels', () => {
  const nodes = [
    { ref: 'h1', role: 'AXHeading', name: 'Domains and Subdomains', depth: 8 },
    { ref: 't1', role: 'AXStaticText', name: 'Domains and Subdomains', depth: 9 },
    { ref: 'f1', role: 'AXTextArea', name: '', depth: 8 },
    { ref: 'h2', role: 'AXHeading', name: 'Return URLs', depth: 8 },
    { ref: 't2', role: 'AXStaticText', name: 'Return URLs', depth: 9 },
    { ref: 'f2', role: 'AXTextArea', name: '', depth: 8 },
  ].map(n => ({ ...n, value: '', enabled: true, actions: n.role === 'AXTextArea' ? ['setValue'] : [] }));
  const options = textCandidates({ id: 's', source: 'ax', pid: 1, title: 'Apple', truncated: false, nodes });
  assert.match(options[0]!.description, /Domains and Subdomains/);
  assert.match(options[1]!.description, /Return URLs/);
  assert.doesNotMatch(options[1]!.description, /Domains/);
});
test('navigation offers only the focused receiver and excludes protected controls', () => {
  const nodes = [
    { ref: 'a', role: 'AXGroup', focused: true, value: '' },
    { ref: 'b', role: 'AXTextField', focused: false, value: '' },
    { ref: 'c', role: 'AXSecureTextField', focused: true, value: '[secure]' },
  ].map(n => ({ ...n, name: '', enabled: true, depth: 1, actions: ['focus'] }));
  const options = navigationCandidates({ id: 's', source: 'ax', pid: 1, title: 'Apple', truncated: false, nodes });
  assert.equal(options.length, 8); assert.ok(options.every(o => o.action.ref === 'a'));
});
