import type { DesktopAPI, Event as DesktopEvent } from '../shared/contracts.js';
declare global { interface Window { desktop: DesktopAPI } }
const api = window.desktop;
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
    const previous = target.value || localStorage.getItem('last-app') || '';
    const apps = await api.apps();
    target.replaceChildren(...apps.map(app => new Option(app.name, String(app.pid))));
    if (apps.some(a => String(a.pid) === previous)) target.value = previous;
  } catch (e) { report(e); }
  finally { refreshing = false; }
}
window.addEventListener('focus', () => { if (!start.disabled) void refresh().catch(report); });
target.onchange = () => localStorage.setItem('last-app', target.value);
// Re-check while idle so permission grants are reflected without a restart.
setInterval(() => { if (!start.disabled && document.visibilityState === 'visible') void refreshStatus().catch(report); }, 3000);
function onEvent(event: DesktopEvent) {
  element('state').textContent = event.state;
  element('state').dataset.active = String(['selecting', 'acting', 'observing'].includes(event.state));
  timeline.querySelector('.empty')?.remove();
  const row = document.createElement('li');
  const label = document.createElement('strong'); label.textContent = event.state;
  const message = document.createElement('span'); message.textContent = event.message;
  row.append(label, message);
  if (event.candidate) {
    const details = document.createElement('pre'); details.textContent = JSON.stringify(event.candidate.action, null, 2); const disclosure = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Action details'; disclosure.append(summary, details); row.append(disclosure);
  }
  timeline.append(row); while (timeline.children.length > 150) timeline.firstElementChild?.remove(); timeline.scrollTop = timeline.scrollHeight;
  approve.hidden = event.state !== 'approval';
  if (event.snapshot) {
    element('source').textContent = (event.snapshot.source === 'ax' ? 'macOS Accessibility' : 'Browser DOM') + (event.snapshot.truncated ? ' · Partial' : '');
    element('observation').textContent = `${event.snapshot.title}\n\n` + event.snapshot.nodes.map(n => `${' '.repeat(Math.min(n.depth, 8))}${n.role} ${n.name} ${n.value}${n.actions.length ? ' [' + n.actions.join(', ') + ']' : ''}`).join('\n');
    element<HTMLImageElement>('capture').hidden = true;
  }
  if (event.image) { const image = element<HTMLImageElement>('capture'); image.src = `data:image/png;base64,${event.image}`; image.hidden = false; }
  if (['failed', 'stopped', 'succeeded', 'blocked', 'uncertain', 'completed'].includes(event.state)) { start.disabled = false; stop.disabled = true; }
}
api.onEvent(onEvent);
start.onclick = async () => {
  error.textContent = ''; start.disabled = true; stop.disabled = false;
  try {
    await api.start({ goal: element<HTMLTextAreaElement>('goal').value, text: element<HTMLTextAreaElement>('task-text').value || undefined, mode: mode.value === 'jev' ? 'jev' : mode.value === 'browser' ? 'browser' : 'desktop', pid: Number(target.value), vision: element<HTMLInputElement>('vision').checked, autoActions: element<HTMLInputElement>('automatic').checked });
  } catch (e) { report(e); start.disabled = false; stop.disabled = true; }
};
stop.onclick = () => { stop.disabled = true; approve.hidden = true; void api.stop().catch(report); };
approve.onclick = () => { approve.hidden = true; void api.approve().catch(report); };
mode.onchange = () => {
  target.disabled = mode.value === 'browser';
  const single = mode.value === 'jev';
  element('planner-options').hidden = single;
  element('text-options').hidden = !single;
  element('planner-settings').hidden = single;
  element('mode-hint').textContent = single ? 'Opens named apps or continues through control presses and supplied text entry. Only TypeSafe; no screenshots. Stops when complete, blocked, or uncertain.' : 'Review each action unless automatic actions are enabled. This mode requires a Claude planner.';
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
void refresh().catch(report);

element('forget-key').onclick = () => { void api.forgetKey().then(refreshStatus).catch(report); };
