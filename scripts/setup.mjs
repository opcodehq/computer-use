import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const client = process.argv[2];
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: bun run setup codex|claude|both\nBuild Jev and install its skill on the Mac being controlled.');
  process.exit(0);
}
if (!['codex', 'claude', 'both'].includes(client) || process.argv.length !== 3) {
  console.error('Choose your harness: bun run setup codex|claude|both');
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('Run setup on the Mac you want Jev to control. A cloud workspace cannot grant Mac permissions or install a local Mac driver.');
  process.exit(1);
}
const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const [command, args, fix] of [
  ['xcrun', ['--find', 'swiftc'], 'Install Xcode Command Line Tools: xcode-select --install'],
]) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) { console.error(fix); process.exit(1); }
}
for (const [label, args] of [
  ['Installing pinned dependencies', ['install', '--frozen-lockfile']],
  ['Building the Mac driver', ['run', 'build:native']],
  ['Building Jev', ['run', 'build']],
  ['Installing the harness skill and checking readiness', ['dist/cli.mjs', 'setup', client]],
]) {
  console.log(`\n${label}…`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
