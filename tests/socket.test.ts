import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serveSocket, socketRequest, socketPath } from '../src/tool/socket.js';

test('separate CLI connections retain refs and errors without replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-socket-')); const path = join(dir, 's');
  let ref = '', mutations = 0;
  let closed!: () => void; const finished = new Promise<void>(resolve => { closed = resolve; });
  await serveSocket(path, async (method, args) => {
    if (method === 'observe') { ref = 'fresh'; return { ref }; }
    if (method === 'execute') {
      if (args.ref !== ref) throw new Error('Stale ref');
      mutations++; return { mutations };
    }
    throw new Error('Unknown');
  }, async () => { closed(); });
  try {
    const observation = await socketRequest(path, 'observe');
    await assert.rejects(socketRequest(path, 'execute', { ref: 'old' }), /Stale/);
    assert.equal((await socketRequest(path, 'execute', observation)).mutations, 1);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.notEqual(socketPath('/cli', 'a'), socketPath('/cli', 'b'));
  } finally { await socketRequest(path, '__stop'); await finished; await rm(dir, { recursive: true }); }
});
