import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../src/main/settings.js';
test('TypeSafe settings survive a new store instance with owner-only file permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-settings-'));
  const path = join(dir, 'config', 'settings.json');
  try {
    const store = new SettingsStore(path);
    assert.equal(await store.load(), '');
    await store.save('test-only-credential');
    assert.equal(await new SettingsStore(path).load(), 'test-only-credential');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, 'config'))).mode & 0o777, 0o700);
    await assert.rejects(store.save('  '));
    assert.equal(await store.load(), 'test-only-credential');
    await store.save('replacement');
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { typesafeKey: 'replacement' });
    await store.forget(); assert.equal(await store.load(), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('malformed settings produce a recoverable message without revealing content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-settings-'));
  try {
    const path = join(dir, 'settings.json'); await writeFile(path, 'PRIVATE-INVALID-CONTENT');
    await assert.rejects(new SettingsStore(path).load(), error => error instanceof Error && /Save your TypeSafe key again/.test(error.message) && !error.message.includes('PRIVATE'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
