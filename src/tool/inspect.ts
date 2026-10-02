import type { Snapshot } from '../shared/contracts.js';

type Call = (method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
/** Choose observation transport without guessing which logged-in tab belongs to an app. */
export async function inspectSurface(native: Call, browser: Call, input: Record<string, unknown>, signal?: AbortSignal) {
  const route = input.route ?? 'auto';
  if (!['auto', 'ax', 'vision', 'browser'].includes(String(route))) throw new Error('route must be auto, ax, vision, or browser.');
  if (route === 'browser' || (route === 'auto' && input.pageId)) {
    if (typeof input.pageId !== 'string') throw new Error('Select pageId from browser tabs before inspecting the page.');
    const snapshot = await browser('browser', { operation: 'observe', pageId: input.pageId, frameId: input.frameId }, signal);
    return { route: 'browser', snapshot, next: 'Use browser operations with this pageId and fresh refs. Verify the requested content, not just the page URL.' };
  }
  if (typeof input.app !== 'string' || !input.app) throw new Error('Supply app for native inspection or pageId for an explicitly connected browser.');
  const args = { ...input, visual: false };
  const semantic = await native('observe', args, signal) as Snapshot;
  const content = semantic.nodes.filter(n => n.value !== '[secure]' && ['AXStaticText', 'AXHeading', 'AXTextArea'].includes(n.role))
    .map(n => n.name + ' ' + n.value).join('\n').trim();
  const queryMissing = typeof input.query === 'string' && !content.toLowerCase().includes(input.query.toLowerCase());
  const sparse = semantic.truncated || content.length < 40 || queryMissing;
  if (route === 'ax' || (route === 'auto' && !sparse)) return { route: 'ax', snapshot: semantic, reason: 'Accessibility content available; completeness still requires task-specific verification.' };
  const observed = await native('observe', { ...args, windowId: semantic.windowId, visual: true, includeImage: true }, signal) as Snapshot | { snapshot: Snapshot; image?: { base64: string } };
  const visual = 'snapshot' in observed ? observed.snapshot : observed;
  const image = 'snapshot' in observed ? observed.image : undefined;
  const available = visual.visual && visual.visual.model !== 'unavailable';
  return { route: available ? 'vision' : 'ax', snapshot: visual, ...(image ? { image } : {}),
    reason: available ? 'Added local OCR and detected visual regions to Accessibility.' : 'Accessibility is sparse and visual capture is unavailable.',
    next: available ? 'Use fresh refs or capture this exact window for your host model to inspect pixels.' : 'Check the visual warning for missing capture permission or model setup. For a supported browser, attach its explicit debugging endpoint and select a pageId. Do not assume an empty AX tree means an empty page.' };
}
