import type { Event, Snapshot } from '../shared/contracts.js';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const terminal = new Set(['failed','stopped','succeeded','blocked','uncertain','completed']);
export class ComputerPreview {
  private snapshot?: Snapshot;
  private frame?: { x: number; y: number; width: number; height: number };
  private clearTimer?: ReturnType<typeof setTimeout>;
  private hasImage = false;
  reset() {
    this.snapshot = undefined; this.frame = undefined; this.hasImage = false;
    el('capture').hidden = true; el('semantic-map').hidden = true; el('preview-empty').hidden = false;
    this.clearMarkers();
  }
  clearMarkers() {
    clearTimeout(this.clearTimer); el('virtual-cursor').hidden = true; el('action-ring').hidden = true;
  }
  update(event: Event) {
    if (event.state === 'starting') this.reset();
    if (event.state === 'refreshing') this.clearMarkers();
    if (event.image && event.imageFrame) {
      this.hasImage = true; this.frame = event.imageFrame;
      const image = el<HTMLImageElement>('capture'); image.src = `data:image/png;base64,${event.image}`; image.hidden = false;
      el('semantic-map').hidden = true; el('preview-empty').hidden = true;
      el('preview-status').textContent = `Window capture · ${new Date().toLocaleTimeString()}`;
    }
    if (event.snapshot?.visual?.model === 'unavailable') { this.hasImage = false; el('capture').hidden = true; }
    if (event.snapshot) {
      this.snapshot = event.snapshot;
      el('preview-title').textContent = event.snapshot.title || 'Computer';
      const visual = event.snapshot.visual;
      el('perception-status').textContent = visual ? `${visual.model} · ${visual.regionCount} regions · ${Math.round(visual.durationMs)} ms` : 'Accessibility';
      el('perception-status').title = visual?.warning ?? '';
      if (!this.hasImage) this.drawSemantic(event.snapshot);
      if (visual?.warning) el('preview-status').textContent = visual.warning;
    }
    if (event.candidate && this.frame && this.snapshot) {
      const node = this.snapshot.nodes.find(n => n.ref === event.candidate?.action.ref);
      const bounds = node?.frame;
      if (bounds) {
        const x = 100 * (bounds.x + bounds.width / 2 - this.frame.x) / this.frame.width;
        const y = 100 * (bounds.y + bounds.height / 2 - this.frame.y) / this.frame.height;
        if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
          clearTimeout(this.clearTimer);
          const cursor = el('virtual-cursor'); cursor.hidden = false; cursor.style.left = `${x}%`; cursor.style.top = `${y}%`;
          el('cursor-label').textContent = `${event.candidate.action.kind} · ${node?.name || 'control'}`;
          const ring = el('action-ring'); ring.style.left = `${x}%`; ring.style.top = `${y}%`; ring.hidden = event.state !== 'acting';
          this.clearTimer = setTimeout(() => this.clearMarkers(), 2200);
        }
      }
    }
    if (terminal.has(event.state)) {
      this.clearMarkers();
      el('preview-status').textContent = event.state === 'succeeded' ? '✓ Task verified complete' : event.message;
    }
  }
  private drawSemantic(snapshot: Snapshot) {
    const nodes = snapshot.nodes.filter(n => n.frame && n.frame.width > 0 && n.frame.height > 0);
    const root = nodes.find(n => n.role === 'AXWindow')?.frame;
    if (!root) return;
    this.frame = root;
    const map = el('semantic-map'); map.replaceChildren(); map.hidden = false; el('preview-empty').hidden = true;
    map.style.aspectRatio = `${root.width} / ${root.height}`; map.style.height = 'auto'; map.style.maxWidth = '100%';
    for (const node of nodes.filter(n => n.actions.length > 0 || n.name).slice(0,200)) {
      const b = node.frame!;
      const item = document.createElement('div'); item.className = 'semantic-node'; item.textContent = node.name || node.role;
      item.style.left = `${100*(b.x-root.x)/root.width}%`; item.style.top = `${100*(b.y-root.y)/root.height}%`;
      item.style.width = `${100*b.width/root.width}%`; item.style.height = `${100*b.height/root.height}%`; map.append(item);
    }
    el('preview-status').textContent = 'Semantic layout · not a screenshot';
  }
}
