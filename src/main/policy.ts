import { Schema } from 'effect';
import type { Candidate, Snapshot } from '../shared/contracts.js';

export class PolicyError extends Schema.TaggedErrorClass<PolicyError>()('PolicyError', { message: Schema.String }) {}

export function validateCandidate(candidate: Candidate, snapshot: Snapshot, hasImage: boolean): void {
  const action = candidate.action;
  const reject = (message: string): never => { throw new PolicyError({ message }); };
  if (!candidate.id || candidate.id === 'none' || candidate.id.length > 64) reject('Invalid candidate ID.');
  if ((action.text?.length ?? 0) > 8000) reject('Text exceeds the beta action limit.');
  if (action.kind === 'navigate') {
    if (snapshot.source !== 'dom') reject('Navigation requires the isolated browser.');
    let url: URL;
    try { url = new URL(action.text ?? ''); } catch { return reject('Invalid navigation URL.'); }
    if (!['https:', 'http:'].includes(url.protocol)) reject('Only HTTP(S) navigation is allowed.');
    return;
  }
  if (action.kind === 'click') {
    if (snapshot.source !== 'ax' || !hasImage || !Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x! < 0 || action.y! < 0) reject('Pixel actions require fresh visual evidence.');
    return;
  }
  const node = snapshot.nodes.find(node => node.ref === action.ref);
  if (!node || !node.enabled || node.value === '[secure]') return reject('The target is missing, disabled, or protected.');
  if (action.kind === 'backgroundKey') {
    if (snapshot.source !== 'ax' || !node.focused || !['Tab','Shift+Tab','Option+Tab','Option+Shift+Tab','ArrowDown','ArrowUp','Enter','Escape','Space'].includes(action.text ?? '')) reject('Keyboard navigation requires the observed focused control and a supported key.');
    return;
  }
  const capability = action.kind === 'press' ? 'AXPress' : action.kind;
  if (!['press', 'focus', 'setValue', 'insertText'].includes(action.kind) || !node.actions.includes(capability)) reject('The target does not support this action.');
  if (!['press','focus'].includes(action.kind) && action.text === undefined) reject('Text action requires explicit text.');
}

/** Revokes dispatch synchronously, before asynchronous fiber cleanup. */
export class RunGate {
  private generation = 0;
  private active = false;
  begin(): number {
    if (this.active) throw new PolicyError({ message: 'A task is already active.' });
    this.active = true;
    return ++this.generation;
  }
  assert(token: number): void {
    if (!this.active || token !== this.generation) throw new PolicyError({ message: 'Task cancelled. No further actions may be sent.' });
  }
  stop(): void { this.active = false; ++this.generation; }
  finish(token: number): void { if (token === this.generation) this.active = false; }
}
