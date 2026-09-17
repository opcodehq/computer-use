import { createServer, createConnection } from 'node:net';
import { mkdir, chmod, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function socketPath(entry: string, session: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(session)) throw new Error('Session name must be 1–64 letters, digits, underscores or hyphens.');
  const identity = JSON.stringify([entry, session, process.env.JEV_ALLOWED_APP, process.env.JEV_DRIVER_PATH, process.env.JEV_SETTINGS_PATH]);
  const key = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return join(tmpdir(), `jev-${process.getuid?.() ?? 'user'}`, `${key}.sock`);
}
export async function secureDirectory(path: string) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Session directory must be owned by this user.');
  await chmod(path, 0o700);
}
export function socketRequest(path: string, method: string, args: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path); let buffer = ''; let sent = false; let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; reject(sent ? Object.assign(new Error('Session disconnected after request; delivery unknown. Observe before retrying.'), { delivery: 'unknown' }) : error); } socket.destroy(); };
    socket.setTimeout(120000, () => fail(new Error('Session timed out')));
    socket.on('error', fail);
    socket.on('connect', () => { sent = true; socket.write(JSON.stringify({ method, args }) + '\n'); });
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 16_000_000) { fail(new Error('Session response too large')); return; }
      if (!buffer.includes('\n')) return;
      try {
        const reply = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        settled = true; socket.destroy();
        if (reply.ok) resolve(reply.result);
        else reject(Object.assign(new Error(reply.error.message), { code: reply.error.code, delivery: reply.error.delivery }));
      } catch (error) { fail(error instanceof Error ? error : new Error('Invalid response')); }
    });
    socket.on('close', () => { if (!settled) fail(new Error('Session closed')); });
  });
}
export async function ensureSession(path: string, entry: string, session: string) {
  try { await socketRequest(path, '__ping'); return; }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const child = spawn(process.execPath, [entry, '_serve', '--session', session], {
    detached: true, stdio: 'ignore', env: { ...process.env, JEV_INTERACTION_MODE: 'background' },
  });
  child.on('error', () => {}); child.unref();
  for (let attempt = 0; attempt < 50; attempt++) {
    await delay(100);
    try { await socketRequest(path, '__ping'); return; } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || !['ENOENT', 'ECONNREFUSED'].includes(String(error.code))) throw error;
    }
  }
  throw new Error('Desktop session did not start. Run doctor on this Mac.');
}
export async function serveSocket(path: string, call: (method: string, args: Record<string, unknown>) => Promise<unknown>, close: () => Promise<void>) {
  let active = 0;
  let ending = false;
  const stop = async () => {
    if (ending) return; ending = true; clearInterval(idle);
    server.close(); await unlink(path).catch(() => {}); await close();
  };
  let lastUsed = Date.now();
  const idle = setInterval(() => { if (!active && Date.now() - lastUsed > 30 * 60_000) void stop(); }, 30_000);
  const server = createServer(socket => {
    let buffer = ''; let handled = false;
    socket.setTimeout(10000, () => { if (!handled) socket.destroy(); });
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      if (handled) return;
      buffer += chunk.toString();
      if (buffer.length > 1_000_000) { handled = true; socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      handled = true; active++; lastUsed = Date.now(); let shouldStop = false;
      try {
        const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (!request || typeof request.method !== 'string' || !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('Invalid request');
        if (request.method === '__stop' && active > 1) throw new Error('Session is busy. Wait before stopping.');
        shouldStop = request.method === '__stop';
        const result = request.method === '__ping' ? { ready: true } : shouldStop ? { stopped: true } : await call(request.method, request.args);
        socket.end(JSON.stringify({ ok: true, result }) + '\n');
      } catch (error) {
        socket.end(JSON.stringify({ ok: false, error: { message: error instanceof Error ? error.message : 'Request failed',
          code: error instanceof Error && 'code' in error ? String(error.code) : 'ToolError',
          delivery: error instanceof Error && 'delivery' in error ? String(error.delivery) : 'notDispatched' } }) + '\n');
      } finally { active--; lastUsed = Date.now(); if (shouldStop) void stop(); }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    await chmod(path, 0o600);
  } catch (error) { clearInterval(idle); await close(); throw error; }
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
}
