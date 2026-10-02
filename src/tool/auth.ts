import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { SettingsStore } from '../main/settings.js';
import { settingsPath } from './harness.js';

export async function authenticate(stdin: boolean) {
  let key = '';
  if (stdin) {
    for await (const chunk of process.stdin) {
      key += chunk.toString();
      if (key.length > 16000) throw new Error('API key input is too long.');
    }
  } else {
    if (!process.stdin.isTTY) throw new Error('Use jev auth --stdin to read a key from a pipe.');
    const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const reader = createInterface({ input: process.stdin, output: silent, terminal: true });
    const abort = new AbortController();
    reader.on('SIGINT', () => abort.abort());
    process.stderr.write('TypeSafe API key (hidden): ');
    try { key = await reader.question('', { signal: abort.signal }); }
    finally { reader.close(); process.stderr.write('\n'); }
  }
  await new SettingsStore(settingsPath()).save(key);
  console.log('TypeSafe key saved. Run jev doctor to check readiness.');
}
