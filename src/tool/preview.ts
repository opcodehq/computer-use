import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Event, Snapshot } from '../shared/contracts.js';

const terminal = new Set(['failed', 'stopped', 'succeeded', 'blocked', 'uncertain', 'completed']);
/** Display-only data: no field values, actionable refs, or model credentials. */
export function previewPacket(event: Event, previous?: Snapshot) {
  const snapshot = event.snapshot ?? previous;
  const nodes = snapshot?.nodes.filter(n => n.frame && n.role !== 'AXSecureTextField').slice(0, 300);
  const target = snapshot?.nodes.find(n => n.ref === event.candidate?.action.ref) ?? (event.state === 'acting' ? snapshot?.nodes.find(n => n.focused) : undefined);
  return {
    state: event.state, message: event.candidate && target ? `${event.candidate.action.kind === 'press' ? 'Click' : 'Interact with'} ${target.name || target.role}` : event.message.slice(0, 800), terminal: terminal.has(event.state),
    title: snapshot?.title, snapshotId: snapshot?.id,
    frame: event.imageFrame ?? nodes?.find(n => n.role === 'AXWindow')?.frame,
    nodes: nodes?.map(n => ({ frame: n.frame, label: n.name.slice(0, 120), role: n.role })),
    image: event.image,
    target: terminal.has(event.state) ? null : target?.frame,
    action: event.candidate?.action.kind,
  };
}

export async function openTaskPreview(binary: string, stop: () => void, warn: (message: string) => void) {
  try { await access(binary, constants.X_OK); }
  catch { warn('Preview helper is missing. Reinstall the complete bundle; this task will continue without a preview.'); return undefined; }
  const child: ChildProcessWithoutNullStreams = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let snapshot: Snapshot | undefined;
  let stopRequested = false;
  let closed = false, pending: string | undefined, blocked = false, buffer = '';
  const write = (data: string) => {
    if (closed || child.stdin.destroyed) return;
    if (blocked) { pending = data; return; }
    blocked = !child.stdin.write(data);
  };
  child.stdin.on('drain', () => { blocked = false; if (pending) { const value = pending; pending = undefined; write(value); } });
  child.stdin.on('error', () => { closed = true; });
  child.on('error', () => { closed = true; warn('Preview could not open; task output is still available in this terminal.'); });
  child.on('exit', () => { closed = true; });
  child.stderr.resume();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 4096) { buffer = ''; return; }
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line === '{"stop":true}' && !stopRequested) { stopRequested = true; stop(); }
    }
  });
  return {
    send(event: Event) { if (event.state === 'resumed') stopRequested = false; if (event.snapshot) snapshot = event.snapshot; write(JSON.stringify(previewPacket(event, snapshot)) + '\n'); },
    async close() {
      if (closed) return;
      // Flush the newest terminal event before EOF. Never let a stuck UI hold up CLI exit.
      if (pending) { child.stdin.write(pending); pending = undefined; }
      child.stdin.end();
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 2200);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
