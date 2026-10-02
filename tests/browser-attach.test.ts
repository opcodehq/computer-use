import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTools } from '../src/browser/tools.js';

test('attachment requires a local endpoint',async()=>{
 const tool=new BrowserTools();
 await assert.rejects(tool.call({operation:'attach',endpoint:'https://example.com'}),/loopback/);
});
test('existing-browser integration through the shipped Node runtime', { skip: process.platform !== 'linux', timeout: 30000 }, async()=>{
 const { execFile } = await import('node:child_process');
 const { promisify } = await import('node:util');
 const result = await promisify(execFile)('node', ['scripts/test-browser-attach.mjs'], { timeout: 25000 });
 assert.match(result.stdout, /PASS existing-browser/);
});
