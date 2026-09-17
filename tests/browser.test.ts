import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { BrowserDriver } from '../src/main/browser.js';

const chrome = process.env.TEST_CHROME_PATH ?? '/usr/bin/google-chrome';
test('DOM route fills a real form, observes its result, and rejects stale refs', { skip: !existsSync(chrome) }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Driver fixture</title><form><input aria-label="Name"><button>Save</button></form><p role="status">Waiting</p><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("[role=status]").textContent="Saved: "+document.querySelector("input").value}</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const driver = new BrowserDriver({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    let s = await driver.snapshot();
    await driver.execute({ kind: 'navigate', text: `http://127.0.0.1:${address.port}` }, s.id);
    s = await driver.snapshot();
    const input = s.nodes.find(n => n.name === 'Name'); assert.ok(input);
    await driver.execute({ kind: 'setValue', ref: input.ref, text: 'Jev test' }, s.id);
    await assert.rejects(driver.execute({ kind: 'setValue', ref: input.ref, text: 'duplicate' }, s.id), /Stale/);
    s = await driver.snapshot();
    const save = s.nodes.find(n => n.name === 'Save'); assert.ok(save);
    await driver.execute({ kind: 'press', ref: save.ref }, s.id);
    s = await driver.snapshot();
    assert.ok(s.nodes.some(n => n.name === 'Saved: Jev test'));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(driver.execute({ kind: 'navigate', text: 'https://example.com' }, s.id, abort.signal));
  } finally { await driver.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
