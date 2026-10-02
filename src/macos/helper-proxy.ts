import { connect, type Socket } from 'node:net';
import { lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = `/tmp/opcode-cu-${process.getuid!()}`;
await mkdir(directory, { mode: 0o700, recursive: true });
const metadata = await lstat(directory);
if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid!() || (metadata.mode & 0o077)) throw new Error('Unsafe helper socket directory.');
const endpoint = join(directory, 'driver.sock');
const open = () => new Promise<Socket>((resolve, reject) => {
  const socket = connect(endpoint);
  socket.once('error', reject);
  socket.once('connect', () => { socket.off('error', reject); resolve(socket); });
});
let socket: Socket | undefined;
try { socket = await open(); } catch {}
if (!socket && process.argv.includes('--shutdown')) process.exit(0);
if (!socket) {
  const app = join(homedir(), 'Library/Application Support/Opcode/CU Driver.app');
  const result = spawnSync('/usr/bin/open', ['-g', '-a', app], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error('Install the Mac helper with cu install.');
  for (let i = 0; i < 100 && !socket; i++) { await delay(100); try { socket = await open(); } catch {} }
}
if (!socket) throw new Error('Mac helper did not start. Run cu install, then check permissions for Opcode CU Driver.');
socket.on('error', () => { console.error('Mac helper disconnected; delivery may be unknown. Observe before retrying.'); process.exitCode = 1; });
if (process.argv.includes('--shutdown')) {
  const timer = setTimeout(() => { socket!.destroy(); process.exitCode = 1; }, 5000);
  socket.on('data', () => { process.exitCode = 1; socket!.destroy(); }); // Successful shutdown exits without a reply; a reply is a refusal.
  socket.once('close', () => clearTimeout(timer));
  socket.end(JSON.stringify({ id: 'shutdown', method: 'helperShutdown' }) + '\n');
}
else {
  socket.pipe(process.stdout);
  process.stdin.pipe(socket);
  socket.once('close', () => { process.stdin.destroy(); });
  for (const name of ['SIGTERM', 'SIGINT'] as const) process.once(name, () => { socket!.destroy(); process.exit(0); });
}
