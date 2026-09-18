import { ComputerPreview } from './preview.js';
import type { DesktopAPI, Event as DesktopEvent } from '../shared/contracts.js';
declare global { interface Window { desktop: DesktopAPI } }
const api = window.desktop;
const preview = new ComputerPreview();
const isPopout = new URLSearchParams(location.search).has('preview');
if (isPopout) document.body.classList.add('popout');
if (/Mac/.test(navigator.platform)) document.body.classList.add('platform-mac');
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
const approve = element<HTMLButtonElement>('approve');
const mode = element<HTMLSelectElement>('mode');
const target = element<HTMLSelectElement>('target');
const error = element<HTMLParagraphElement>('error');
const timeline = element<HTMLOListElement>('timeline');
const report = (e: unknown) => { error.textContent = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); };
let refreshing = false;
async function refreshStatus() {
  const [status, connection] = await Promise.all([api.status(), api.connection()]);
  element('detector-status').textContent = status.visual?.modelInstalled ? '✓ CoreML detector installed · local OCR available' : 'OCR available on macOS. Install a CoreML detector to enable YOLO.';
  element('permissions').textContent = status.error ?? `macOS Accessibility ${status.accessibility ? 'enabled' : 'needed'} · Capture ${status.screenRecording ? 'enabled' : 'optional'}`;
  for (const [id, enabled, name] of [['ax', status.accessibility, 'Accessibility'], ['screen', status.screenRecording, 'Optional capture']] as const) {
    const button = element<HTMLButtonElement>(id);
    button.textContent = enabled ? `✓ ${name} enabled` : `Enable ${name.toLowerCase()}`;
    button.disabled = enabled; button.dataset.done = String(enabled);
  }
  element('connection-status').textContent = connection.error ?? (connection.saved ? '✓ TypeSafe key saved — ready after restart' : connection.configured ? '✓ TypeSafe connected through environment' : 'Add your TypeSafe key to get started.');
  element('storage-path').textContent = `Saved key location: ${connection.path}`;
  element('setup-state').textContent = connection.configured && status.accessibility ? '✓ Ready' : 'Setup needed';
  element<HTMLInputElement>('typesafe-key').placeholder = connection.configured ? 'Saved • enter a new key to replace it' : 'TYPESAFE_API_KEY';
  element<HTMLButtonElement>('forget-key').hidden = !connection.configured;
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await refreshStatus();
    const previous = target.value && target.value !== '0' ? target.value : localStorage.getItem('last-app') || '';
    const apps = await api.apps();
    target.replaceChildren(new Option('Choose an application', '0'), ...apps.sort((a,b) => a.name.localeCompare(b.name)).map(app => new Option(app.name, String(app.pid))));
    if (apps.some(a => String(a.pid) === previous)) target.value = previous;
  } catch (e) { report(e); }
  finally { refreshing = false; }
}
window.addEventListener('focus', () => { if (!isPopout && !start.disabled) void refresh().catch(report); });
target.onchange = () => { localStorage.setItem('last-app', target.value); preview.reset(); };
// Re-check while idle so permission grants are reflected without a restart.
setInterval(() => { if (!isPopout && !start.disabled && document.visibilityState === 'visible') void refreshStatus().catch(report); }, 3000);
function onEvent(event: DesktopEvent) {
  preview.update(event);
  const previewStop = element<HTMLButtonElement>('preview-stop');
  previewStop.hidden = !isPopout;
  if (['starting','waiting','recovering','refreshing','selecting','acting','observing','deciding','verifying','approval'].includes(event.state)) previewStop.disabled = false;
  if (['failed','stopped','succeeded','blocked','uncertain','completed'].includes(event.state)) previewStop.disabled = true;
  if (['starting','waiting','recovering','refreshing','selecting','acting','observing','deciding','verifying','approval'].includes(event.state)) { start.disabled = true; stop.disabled = false; target.disabled = true; mode.disabled = true; }
  element('state').textContent = event.state.replace(/^./, c => c.toUpperCase());
  element('state').dataset.state = event.state;
  element('state').dataset.active = String(['selecting', 'acting', 'observing'].includes(event.state));
  timeline.querySelector('.empty')?.remove();
  const row = document.createElement('li'); row.dataset.state = event.state;
  const label = document.createElement('strong'); label.textContent = event.state;
  const message = document.createElement('span'); message.textContent = event.message;
  row.append(label, message);
  if (event.candidate) {
    const details = document.createElement('pre'); details.textContent = JSON.stringify(event.candidate.action, null, 2); const disclosure = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Action details'; disclosure.append(summary, details); row.append(disclosure);
  }
  timeline.append(row); while (timeline.children.length > 150) timeline.firstElementChild?.remove(); timeline.scrollTop = timeline.scrollHeight;
  approve.hidden = event.state !== 'approval';
  if (event.snapshot) {
    if (start.disabled && !isPopout) {
      const pid = String(event.snapshot.pid);
      if (![...target.options].some(option => option.value === pid)) target.add(new Option(event.snapshot.title, pid));
      target.value = pid;
    }
    element('source').textContent = (event.snapshot.source === 'ax' ? 'macOS Accessibility' : 'Browser DOM') + (event.snapshot.truncated ? ' · Partial' : '');
    element('observation').textContent = `${event.snapshot.title}\n\n` + event.snapshot.nodes.map(n => `${' '.repeat(Math.min(n.depth, 8))}${n.role} ${n.name} ${n.value}${n.actions.length ? ' [' + n.actions.join(', ') + ']' : ''}`).join('\n');

  }

  if (['failed', 'stopped', 'succeeded', 'blocked', 'uncertain', 'completed'].includes(event.state)) { start.disabled = false; stop.disabled = true; target.disabled = mode.value === 'browser'; mode.disabled = false; }
}
api.onEvent(onEvent);
start.onclick = async () => {
  error.textContent = ''; start.disabled = true; stop.disabled = false; preview.reset(); timeline.replaceChildren();
  try {
    await api.start({ localVisual: element<HTMLInputElement>('local-visual').checked, overlay: element<HTMLInputElement>('overlay').checked, modelPath: element<HTMLInputElement>('model-path').value.trim() || undefined, goal: element<HTMLTextAreaElement>('goal').value, text: element<HTMLTextAreaElement>('task-text').value || undefined, mode: mode.value === 'jev' ? 'jev' : mode.value === 'browser' ? 'browser' : 'desktop', pid: Number(target.value), vision: element<HTMLInputElement>('vision').checked, autoActions: element<HTMLInputElement>('automatic').checked });
  } catch (e) { report(e); start.disabled = false; stop.disabled = true; }
};
stop.onclick = () => { stop.disabled = true; approve.hidden = true; void api.stop().catch(report); };
approve.onclick = () => { approve.hidden = true; void api.approve().catch(report); };
mode.onchange = () => {
  target.disabled = mode.value === 'browser';
  const single = mode.value === 'jev';
  element('planner-options').hidden = single;
  element<HTMLInputElement>('local-visual').closest<HTMLElement>('.vision-options')!.hidden = !single;
  element('text-options').hidden = !single;
  element('planner-settings').hidden = single;
  element('mode-hint').textContent = single ? 'Opens named apps or continues through control presses and supplied text entry. TypeSafe only. Optional vision runs locally; no screenshots are sent to Jev. Stops when complete, blocked, or uncertain.' : 'Review each action unless automatic actions are enabled. This mode requires a Claude planner.';
  start.textContent = single ? 'Run Jev task ↗' : 'Start task ↗';
};
mode.dispatchEvent(new Event('change'));
element('refresh').onclick = () => { void refresh().catch(report); };
element('ax').onclick = () => { void api.permission('accessibility').then(refresh).catch(report); };
element('screen').onclick = () => { void api.permission('screenRecording').then(refresh).catch(report); };
element('save').onclick = () => {
  void api.configure({ typesafeKey: element<HTMLInputElement>('typesafe-key').value, anthropicKey: element<HTMLInputElement>('claude-key').value, model: element<HTMLInputElement>('model').value }).then(() => {
    element<HTMLInputElement>('typesafe-key').value = ''; element<HTMLInputElement>('claude-key').value = '';
    error.textContent = '';
    void refreshStatus().catch(report);
  }).catch(report);
};
if (!isPopout) void refresh().catch(report);

element('forget-key').onclick = () => { void api.forgetKey().then(refreshStatus).catch(report); };

for (const id of ['local-visual','overlay','model-path']) {
  const input = element<HTMLInputElement>(id);
  const saved = localStorage.getItem(id);
  if (input.type === 'checkbox') input.checked = saved === 'true'; else input.value = saved ?? '';
  input.onchange = () => localStorage.setItem(id, input.type === 'checkbox' ? String(input.checked) : input.value);
}
element('preview').onclick = async () => {
  error.textContent = '';
  const button = element<HTMLButtonElement>('preview');
  button.disabled = true;
  element('preview-status').textContent = 'Capturing window…';
  try { await api.preview({ pid: Number(target.value), overlay: element<HTMLInputElement>('overlay').checked, modelPath: element<HTMLInputElement>('model-path').value.trim() || undefined }); }
  catch (e) { report(e); element('preview-status').textContent = 'Capture failed; displayed frame has not updated.'; }
  finally { button.disabled = false; }
};
element('popout').onclick = () => { void api.popout().catch(report); };

element('preview-stop').onclick = () => { void api.stop().catch(e => { element('preview-status').textContent = e instanceof Error ? e.message : String(e); }); };
