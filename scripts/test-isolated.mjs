import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Browser and subprocess integration tests must not share runner worker state.
const files = (await readdir('tests', { recursive: true }))
  .filter(file => file.endsWith('.test.ts'))
  .sort();
if (files.length === 0) throw new Error('No test files found.');

for (const file of files) {
  const result = spawnSync('bun', ['test', '--timeout', '30000', join('tests', file)], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Test file failed: ${file}${result.signal ? ` (${result.signal})` : ''}`);
    process.exit(result.status ?? 1);
  }
}
console.log(`Completed all ${files.length} test files in isolated runners.`);
