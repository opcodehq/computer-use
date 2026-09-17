import type { Candidate, Snapshot } from '../shared/contracts.js';

/** Only opens a popup, and only for an observed title tied to the opened result. */
export function shareMenuForOpenedDocument(goal: string, snapshot: Snapshot, candidates: Candidate[], history: string[]): Candidate | undefined {
  if (!/\bshar(?:e|ing)\b/i.test(goal)) return;
  const titles = snapshot.nodes.filter(n => n.role === 'AXTextArea' && n.value.trim() && n.value.length <= 300 && !n.value.includes('\n') && n.value !== '[secure]').map(n => n.value.trim());
  if (!titles.some(title => history.some(entry => entry.includes(title)))) return;
  const matches = candidates.filter(c => c.action.kind === 'press' && snapshot.nodes.some(n => n.ref === c.action.ref && n.role === 'AXPopUpButton' && n.name.trim().toLowerCase() === 'share'));
  if (matches.length === 1) return matches[0];
  if (matches.length !== 2) return;
  const framed = matches.map(candidate => ({ candidate, frame: snapshot.nodes.find(n => n.ref === candidate.action.ref)?.frame }));
  const [first, second] = framed;
  if (!first?.frame || !second?.frame) return;
  const a = first.frame, b = second.frame;
  if (Math.abs(a.y - b.y) > 2 || Math.abs(a.height - b.height) > 2) return;
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  if (gap < 0 || gap > 12 || Math.max(a.width, b.width) < Math.min(a.width, b.width) * 1.5) return;
  // Adjacent same-labelled popup icon + text control: prefer the wider text target.
  return a.width > b.width ? first.candidate : second.candidate;
}
