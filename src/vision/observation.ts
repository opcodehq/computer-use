import { Schema } from 'effect';
import type { Snapshot, Candidate } from '../shared/contracts.js';
const Bounds = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number });
export const VisualSchema = Schema.Struct({
  snapshotId: Schema.String, width: Schema.Number, height: Schema.Number,
  pointSize: Schema.optional(Schema.Struct({ width: Schema.Number, height: Schema.Number })),
  origin: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number })),
  actionable: Schema.Boolean, model: Schema.String, durationMs: Schema.Number,
  warning: Schema.optional(Schema.String), overlay: Schema.optional(Schema.String), image: Schema.optional(Schema.String),
  regions: Schema.Array(Schema.Struct({ ref: Schema.String, label: Schema.String, confidence: Schema.Number, source: Schema.Literals(['yolo','ocr']), bounds: Bounds })),
});
export type VisualObservation = typeof VisualSchema.Type;
export type VisualOptions = { visual?: boolean; modelPath?: string; overlay?: boolean };
type Rect = typeof Bounds.Type;
const area = (r: Rect) => r.width * r.height;
function intersection(a: Rect, b: Rect) {
  return Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
}
/** Keep AX semantics authoritative; add visual refs only where semantic controls are absent. */
export function fuseVisual(snapshot: Snapshot, visual: VisualObservation): Snapshot {
  if (!visual.actionable || visual.snapshotId !== snapshot.id || !visual.origin ||
      ![visual.width,visual.height].every(n => Number.isFinite(n) && n > 0) ||
      ![visual.origin.x, visual.origin.y].every(Number.isFinite)) throw new Error('Visual capture does not match the current window snapshot.');
  const sx = (visual.pointSize?.width ?? visual.width)/visual.width;
  const sy = (visual.pointSize?.height ?? visual.height)/visual.height;
  if (![sx,sy].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid capture scale.');
  const nodes = [...snapshot.nodes];
  for (const region of visual.regions) {
    const b = region.bounds;
    if (!region.ref.startsWith(`${snapshot.id}:visual:`) || ![b.x,b.y,b.width,b.height,region.confidence].every(Number.isFinite) ||
        b.width <= 0 || b.height <= 0 || b.x < 0 || b.y < 0 || b.x+b.width > visual.width+1 || b.y+b.height > visual.height+1 ||
        region.confidence < 0.35 || region.confidence > 1) continue;
    const frame = { x: b.x*sx+visual.origin.x, y: b.y*sy+visual.origin.y, width: b.width*sx, height: b.height*sy };
    // Never reconstruct a protected field from its screenshot pixels.
    if (snapshot.nodes.some(n => n.value === '[secure]' && n.frame && intersection(frame,n.frame) > 0)) continue;
    const semantic = snapshot.nodes.find(n => n.frame && n.enabled && n.value !== '[secure]' &&
      n.actions.some(a => ['AXPress','setValue','insertText'].includes(a)) && intersection(frame,n.frame)/Math.min(area(frame),area(n.frame)) > 0.75 &&
      Math.max(area(frame),area(n.frame))/Math.min(area(frame),area(n.frame)) < 5);
    if (semantic) {
      if (!semantic.name && !semantic.value && region.label) {
        const index = nodes.findIndex(n => n.ref === semantic.ref);
        nodes[index] = { ...nodes[index]!, name: region.label, visualSource: region.source, detectionConfidence: region.confidence };
      }
      continue;
    }
    if (nodes.some(n => n.visualSource && n.frame && intersection(frame,n.frame)/Math.min(area(frame),area(n.frame)) > 0.9)) continue;
    nodes.push({ ref: region.ref, role: region.source === 'yolo' ? 'VisualControl' : 'VisualText', name: region.label,
      value: '', enabled: true, actions: ['visualClick'], depth: 1, frame, visualSource: region.source, detectionConfidence: region.confidence });
  }
  return { ...snapshot, nodes, visual: { model: visual.model, durationMs: visual.durationMs, regionCount: visual.regions.length, warning: visual.warning } };
}
export function visualCandidates(snapshot: Snapshot): Candidate[] {
  return snapshot.nodes.filter(n => n.actions.includes('visualClick') && n.enabled && n.visualSource && n.detectionConfidence! >= 0.35)
    .slice(0, 150).map((n,i) => ({ id: `v${i}`, description: `Visual ${n.visualSource} region: ${n.name || 'unlabeled control'}; detection confidence=${n.detectionConfidence!.toFixed(2)}. Position is known; function and clickability are inferred, not guaranteed.`, action: { kind: 'visualClick', ref: n.ref } }));
}
export async function addVisualObservation(snapshot: Snapshot, request: (method: string, args?: Record<string,unknown>) => Promise<unknown>, options: VisualOptions): Promise<{ snapshot: Snapshot; image?: string; imageFrame?: { x: number; y: number; width: number; height: number } }> {
  if (!options.visual) return { snapshot };
  try {
    const visual = Schema.decodeUnknownSync(VisualSchema)(await request('detect', { snapshotId: snapshot.id, modelPath: options.modelPath, overlay: options.overlay === true }));
    return { snapshot: fuseVisual(snapshot, visual), image: visual.overlay ?? visual.image, imageFrame: { x: visual.origin!.x, y: visual.origin!.y, width: visual.pointSize?.width ?? visual.width, height: visual.pointSize?.height ?? visual.height } };
  } catch (error) {
    // A denied/unavailable capture must not destroy useful semantic evidence.
    return { snapshot: { ...snapshot, visual: { model: 'unavailable', durationMs: 0, regionCount: 0, warning: error instanceof Error ? error.message : 'Visual perception unavailable' } } };
  }
}
