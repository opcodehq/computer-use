import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2);
// Launch Services attributes macOS capture permission to the app bundle. Direct
// shell execution can instead inherit the terminal/command host's TCC identity.
const command = process.platform === 'darwin' ? 'open' : electron;
const args = process.platform === 'darwin'
  ? ['-a', resolve(dirname(electron), '../..'), '--args', root, ...extra]
  : [root, ...extra];
const result = spawnSync(command, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
