import { browserReads } from '../browser/tools.js';
import { Schema } from 'effect';
import { SnapshotSchema, type Event } from '../shared/contracts.js';

type Preview = { send(event: Event): void; close(): Promise<void> };
type Call = (method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
const writes = new Set(['execute', 'type', 'key', 'click', 'act', 'launch', 'input', 'pointer']);
const visible = new Set(['browser', 'preview', 'inspect', 'observe', 'capture', 'wait', ...writes]);

/** One host-agent session owns input, refs and its display-only preview. */
export class DriverSession {
  private preview?: Preview;
  private opened = false;
  private paused = false;
  private busy = false;
  private needsObservation = false;
  private controller = new AbortController();
  constructor(private invoke: Call, private open: (stop: () => void) => Promise<Preview | undefined>, private observeEvent: (event: Event) => void = () => {}) {}
  get hasPreview() { return Boolean(this.preview); }
  event(event: Event) { const next=this.paused ? { ...event, state: 'stopped' } : event; this.preview?.send(next); this.observeEvent(next); }
  stop() {
    this.paused = true;
    this.controller.abort();
    this.event({ state: 'stopped', message: 'Computer input paused. Ask your agent to resume when ready.' });
  }
  async call(method: string, args: Record<string, unknown>, signal?: AbortSignal) {
    if (method === 'pause') { this.stop(); return { status: 'paused' }; }
    if (this.busy) throw new Error('Desktop is busy. Wait for the current call before issuing another.');
    if (method === 'resume') {
      this.paused = false; this.needsObservation = true; this.controller = new AbortController();
      this.event({ state: 'resumed', message: 'Ready for your agent. Observe before choosing the next action.' });
      return { status: 'ready', next: 'Observe fresh state before acting.' };
    }
    const mutating = writes.has(method) || (method === 'browser' && !browserReads.has(String(args.operation)));
    if (this.paused && mutating) throw Object.assign(new Error('Computer input is paused. Resume explicitly, then observe before acting.'), { code: 'UserStopped', delivery: 'notDispatched' });
    if (this.needsObservation && mutating && method !== 'launch' && !(method === 'browser' && args.operation === 'open')) throw new Error('Observe fresh state after resuming before acting.');
    this.busy = true;
    try {
      if (method === 'preview') { await this.preview?.close(); this.preview = undefined; this.opened = false; }
      if (args['no-preview'] === true && !this.opened) this.opened = true;
      if (visible.has(method) && !this.opened) {
        this.opened = true;
        this.preview = await this.open(() => this.stop());
      }
      if (method === 'preview') return { visible: Boolean(this.preview), message: this.preview ? 'Preview opened.' : 'Preview unavailable. On Mac run cu install; on Linux use cu viewer --session NAME.' };
      if (visible.has(method)) this.event({ state: 'observing', message: method === 'browser' ? `Browser: ${String(args.operation ?? 'observe')}` : `Computer: ${method}` });
      if (this.paused && mutating) throw new Error('Input was paused before dispatch.');
      // Read-only inspection remains available while input is paused.
      const combined = AbortSignal.any([...(signal ? [signal] : []), ...(!this.paused ? [this.controller.signal] : [])]);
      combined.throwIfAborted();
      const result = await this.invoke(method, args, combined);
      if ((method === 'inspect' && (args.pageId || args.route === 'browser')) || (method === 'browser' && ['observe','capture'].includes(String(args.operation)))) this.needsObservation = false;
      if (result && typeof result === 'object') {
        const data = result as { snapshot?: unknown; image?: { base64?: string } };
        const snapshot = Schema.is(SnapshotSchema)(result) ? result : Schema.is(SnapshotSchema)(data.snapshot) ? data.snapshot : undefined;
        if (snapshot) this.needsObservation = false;
        if (snapshot) this.event({ state: this.paused ? 'stopped' : 'waiting', message: this.paused ? 'Input paused. Observation only.' : 'Waiting for your agent.', snapshot, image: data.image?.base64 });
      }
      if (method === 'browser') this.event({ state: 'waiting', message: 'Waiting for your agent.' });
      return result;
    } catch (error) {
      if (this.controller.signal.aborted && mutating) {
        throw Object.assign(new Error('Computer input stopped. The last action may have been delivered; observe before deciding whether to retry.'), { code: 'UserStopped', delivery: 'unknown' });
      }
      this.event({ state: 'blocked', message: 'Command did not finish. Inspect the tool response before continuing.' });
      throw error;
    } finally { this.busy = false; }
  }
  async manual(invoke: () => Promise<unknown>) {
    if (!this.paused) throw new Error('Pause agent input before takeover.');
    if (this.busy) throw new Error('Waiting for in-flight input to stop. Try again after observation.');
    this.busy = true;
    try { return await invoke(); } finally { this.busy = false; }
  }
  async close() { this.stop(); await this.preview?.close(); }
}
