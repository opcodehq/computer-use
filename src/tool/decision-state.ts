import type { Candidate, Snapshot } from '../shared/contracts.js';

/** Preserve observed text and all offered targets while dropping empty AX wrappers. */
export function decisionState(goal: string, snapshot: Snapshot, candidates: Candidate[], history: string[]) {
  let editorDepth: number | undefined;
  const sharingTask = /\bshar(?:e|ing)\b/i.test(goal);
  return {
    goal,
    application: snapshot.title,
    observationIsPartial: snapshot.truncated,
    windowOnScreen: snapshot.windowOnScreen,
    observationErrors: snapshot.observationErrors,
    observedText: snapshot.nodes.flatMap(node => {
      if (editorDepth !== undefined && node.depth <= editorDepth) editorDepth = undefined;
      if (sharingTask && node.role === 'AXTextArea' && (node.value.length > 300 || node.value.includes('\n'))) { editorDepth = node.depth; return [{ role: node.role, text: 'Editable document body (omitted for sharing-control selection)' }]; }
      if (sharingTask && editorDepth !== undefined) return [];
      if (node.value === '[secure]') return [];
      const text = [node.name, node.value].filter(Boolean).join(' ');
      return text ? [{ role: node.role, text }] : [];
    }),
    controls: candidates.map(candidate => ({ id: candidate.id, operation: ['setValue','insertText'].includes(candidate.action.kind) ? 'write' : candidate.action.kind, description: candidate.description.replace(/; ref=[^;]+/, '') })),
    history: history.slice(-20),
    currentTime: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
