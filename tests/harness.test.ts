import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { SettingsStore } from '../src/main/settings.js';
import { connection, loadCredential } from '../src/tool/harness.js';
import { runSession } from '../src/tool/session.js';

test('CLI loads saved credentials without exposing them and respects environment override', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-harness-'));
  try {
    const path = join(dir, 'settings.json'); await new SettingsStore(path).save('saved-test-key');
    const env: NodeJS.ProcessEnv = {};
    const result = await loadCredential(path, env);
    assert.equal(env.TYPESAFE_API_KEY, 'saved-test-key'); assert.equal(result.source, 'savedFile');
    assert.ok(!JSON.stringify(result).includes('saved-test-key'));
    env.TYPESAFE_API_KEY = 'override'; await loadCredential(path, env); assert.equal(env.TYPESAFE_API_KEY, 'override');
    assert.equal((await loadCredential(join(dir, 'missing'), {})).source, 'missing');
  } finally { await rm(dir, { recursive: true }); }
});

test('connection arguments preserve literal paths and scope without embedding a key', () => {
  for (const client of ['codex', 'claude']) {
    const result = connection(client, '/tmp/bun space/bun', '/tmp/a $() file/cli.mjs', 'Zuse (Beta)');
    assert.deepEqual(result.args.slice(-3), ['/tmp/bun space/bun', '/tmp/a $() file/cli.mjs', 'mcp']);
    assert.equal(result.server.env.JEV_INTERACTION_MODE, 'background');
    assert.ok(!JSON.stringify(result).includes('TYPESAFE_API_KEY='));
  }
  assert.throws(() => connection('other', '/bun', '/cli'), /codex or claude/);
});

test('persistent JSONL session preserves state and recovers after malformed input', async () => {
  const results: any[] = []; let observed = false;
  const input = Readable.from(['{"id":1,"method":"observe"}\ninvalid\n{"id":2,"method":"execute","args":{"ref":"r"}}\n']);
  await runSession(input, async line => { results.push(JSON.parse(line)); }, async method => {
    if (method === 'observe') { observed = true; return { ref: 'r' }; }
    assert.ok(observed); return { dispatched: true };
  });
  assert.deepEqual(results.map(r => r.ok), [true, false, true]);
  assert.equal(results[2].id, 2);
});
