import { capturePreview } from '../vision/preview.js';
import { addVisualObservation } from '../vision/observation.js';
import { SnapshotSchema } from '../shared/contracts.js';
import { SettingsStore } from './settings.js';
import { runDesktopGoal, taskDecider } from '../tool/task.js';
import { app, BrowserWindow, ipcMain } from 'electron';
import { Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema, StartSchema, type Config, type Event } from '../shared/contracts.js';
import { DesktopDriver, DriverError, driverLayer } from './driver.js';
import { modelLayer } from './models.js';
import { TaskRunner, runnerLayer } from './runner.js';

const root = dirname(fileURLToPath(import.meta.url));
const binary = join(root, '../native/macos/build/desktop-driver');
let window: BrowserWindow | undefined;
let previewWindow: BrowserWindow | undefined;
let lastObservation: Event | undefined;
let lastImage: Event | undefined;
let lastEvent: Event | undefined;
let previewBusy = false;
let config: Config = { typesafeKey: process.env.TYPESAFE_API_KEY ?? '', anthropicKey: process.env.ANTHROPIC_API_KEY ?? '', model: process.env.ANTHROPIC_MODEL ?? '' };
let running: Fiber.Fiber<void, DriverError> | undefined;
let stopping = false;
let singleAction: AbortController | undefined;
let singlePending: Promise<void> | undefined;
let trace = '';
let traceChain = Promise.resolve();
const emit = (event: Event) => {
  lastEvent = event;
  if (event.snapshot) lastObservation = event;
  if (event.image) lastImage = event;
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.webContents.send('task:event', event);
  if (window && !window.isDestroyed()) window.webContents.send('task:event', event);
  // Metadata only: no goals, input text, screenshots, or raw page content on disk.
  if (trace) traceChain = traceChain.then(() => appendFile(trace, JSON.stringify({ at: new Date().toISOString(), state: event.state }) + '\n')).catch(() => {});
};
const native = process.platform === 'darwin' && existsSync(binary)
  ? driverLayer(binary)
  : Layer.succeed(DesktopDriver, { request: () => Effect.fail(new DriverError({ code: 'DriverUnavailable', message: 'Native mode requires macOS and bun run build:native. Isolated browser mode is still available.', delivery: 'notDispatched' })) });
const services = Layer.mergeAll(native, modelLayer(() => config));
const runtime = ManagedRuntime.make(runnerLayer(emit).pipe(Layer.provideMerge(services)));


function trusted(event: Electron.IpcMainInvokeEvent) {
  const allowed = [window, previewWindow].some(candidate => candidate && !candidate.isDestroyed() && candidate.webContents === event.sender);
  if (!allowed || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender.');
}

void app.whenReady().then(async () => {
await mkdir(join(app.getPath('userData'), 'runs'), { recursive: true });
trace = join(app.getPath('userData'), 'runs', 'events.jsonl');
const settings = new SettingsStore(join(app.getPath('userData'), 'config', 'settings.json'));
let saved = false;
let settingsError: string | undefined;
try {
  const key = await settings.load();
  saved = Boolean(key);
  if (key) config = { ...config, typesafeKey: key };
} catch (error) { settingsError = error instanceof Error ? error.message : 'Cannot read saved settings.'; }
ipcMain.handle('connection', event => { trusted(event); return { configured: Boolean(config.typesafeKey), saved, path: settings.path, error: settingsError }; });
ipcMain.handle('forget-key', async event => {
  trusted(event);
  if (running || singleAction) throw new Error('Stop the current run before removing the key.');
  await settings.forget(); config = { ...config, typesafeKey: '' }; saved = false; settingsError = undefined;
});

ipcMain.handle('status', async event => {
  trusted(event);
  try { return await runtime.runPromise(DesktopDriver.use(d => d.request('status'))); }
  catch { return { accessibility: false, screenRecording: false, platform: process.platform, error: 'Native driver unavailable. Build it on your Mac with bun run build:native.' }; }
});
ipcMain.handle('apps', async event => { trusted(event); return runtime.runPromise(DesktopDriver.use(d => d.request('apps'))); });
ipcMain.handle('popout', async event => {
  trusted(event);
  if (previewWindow && !previewWindow.isDestroyed()) { previewWindow.show(); return; }
  previewWindow = new BrowserWindow({ width: 640, height: 490, minWidth: 400, minHeight: 280, title: 'Jev · Computer', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}), alwaysOnTop: true, backgroundColor: '#f3f1eb', webPreferences: { preload: join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  previewWindow.webContents.on('will-navigate', e => e.preventDefault());
  await previewWindow.loadFile(join(root, 'renderer/index.html'), { query: { preview: '1' } });
  if (lastImage) previewWindow.webContents.send('task:event', lastImage);
  if (lastObservation && lastObservation !== lastImage) previewWindow.webContents.send('task:event', lastObservation);
  if (lastEvent && lastEvent !== lastObservation && lastEvent !== lastImage) previewWindow.webContents.send('task:event', lastEvent);
});
ipcMain.handle('preview', async (event, value: unknown) => {
  trusted(event);
  if (running || singleAction || stopping || previewBusy) throw new Error('Preview is already updating or a task is running.');
  const input = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Number, modelPath: Schema.optional(Schema.String), overlay: Schema.Boolean }))(value);
  const request = (method: string, args?: Record<string, unknown>) => runtime.runPromise(DesktopDriver.use(d => d.request(method, args)));
  previewBusy = true;
  try {
    const snapshot = Schema.decodeUnknownSync(SnapshotSchema)(await request('snapshot', { pid: input.pid }));
    if (!input.overlay) {
      emit(await capturePreview(snapshot, request));
    } else {
      const result = await addVisualObservation(snapshot, request, { visual: true, overlay: true, modelPath: input.modelPath });
      emit({ state: 'preview', message: result.snapshot.visual?.warning ?? 'Local window preview. Pixels stay on this Mac.', ...result });
    }
  } finally { previewBusy = false; }
});
ipcMain.handle('permission', async (event, kind: unknown) => {
  trusted(event);
  const permission = Schema.decodeUnknownSync(Schema.Literals(['accessibility', 'screenRecording']))(kind);
  await runtime.runPromise(DesktopDriver.use(d => d.request(permission === 'accessibility' ? 'requestAccessibility' : 'requestScreenRecording')));
});
ipcMain.handle('configure', async (event, value: unknown) => {
  trusted(event);
  if (running || singleAction) throw new Error('Stop the current run before changing providers.');
  const update = Schema.decodeUnknownSync(ConfigSchema)(value);
  if (update.typesafeKey.trim()) {
    await settings.save(update.typesafeKey);
    saved = true; settingsError = undefined;
  }
  config = { typesafeKey: update.typesafeKey.trim() || config.typesafeKey,
    anthropicKey: update.anthropicKey.trim() || config.anthropicKey,
    model: update.model.trim() || config.model };

});
ipcMain.handle('start', async (event, value: unknown) => {
  trusted(event);
  if (running || singleAction || stopping || previewBusy) throw new Error('A task is already running or stopping.');
  lastImage = undefined; lastObservation = undefined;
  const input = Schema.decodeUnknownSync(StartSchema)(value);
  if (!input.goal.trim() || input.goal.length > 8000) throw new Error('Enter a task of up to 8,000 characters.');
  if (input.mode === 'jev') {
    if (!config.typesafeKey) throw new Error('Add only your TypeSafe API key in Connection & permissions.');
    const controller = new AbortController();
    singleAction = controller;
    emit({ state: 'starting', message: 'Jev is checking the task and available actions.' });
    singlePending = (async () => {
      try {
        await runDesktopGoal(input.goal, String(input.pid), (method, args, signal) => runtime.runPromise(DesktopDriver.use(d => d.request(method, args)), { signal }), taskDecider(() => config.typesafeKey), emit, controller.signal, input.text, { visual: input.localVisual, overlay: input.overlay, modelPath: input.modelPath });
      } catch (error) {
        if (!controller.signal.aborted) emit({ state: 'failed', message: error instanceof Error ? error.message : 'Jev action failed.' });
      } finally { singleAction = undefined; }
    })();
    return;
  }
  if (!config.typesafeKey || !config.anthropicKey || !config.model) throw new Error('Add TypeSafe and Claude credentials and a Claude model ID in Settings.');
  emit({ state: 'starting', message: 'Starting a new computer session.' });
  const taskRunner = await runtime.runPromise(TaskRunner);
  const program = taskRunner.run(input).pipe(
    Effect.catch(error => Effect.sync(() => emit({ state: 'failed', message: error.message }))),
    Effect.ensuring(Effect.sync(() => { running = undefined; })),
  );
  running = runtime.runFork(program);
});
ipcMain.handle('approve', async event => { trusted(event); await runtime.runPromise(TaskRunner.use(runner => Effect.sync(() => runner.approve()))); });
ipcMain.handle('stop', async event => {
  trusted(event); stopping = true;
  singleAction?.abort();
  await singlePending;
  try {
    await runtime.runPromise(TaskRunner.use(runner => Effect.sync(() => runner.revoke())));
    if (running) await Effect.runPromise(Fiber.interrupt(running));
    await runtime.runPromise(DesktopDriver.use(d => d.request('cancel')).pipe(Effect.catch(() => Effect.void)));
    emit({ state: 'stopped', message: 'Stopped. No new actions will be dispatched; a previously sent action may have completed.' });
  } finally { stopping = false; }
});

window = new BrowserWindow({ width: 1380, height: 900, minWidth: 900, minHeight: 650, backgroundColor: '#f3f1eb', title: 'Jev Desktop', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}), webPreferences: { preload: join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
await window.loadFile(join(root, 'renderer/index.html'));
app.on('window-all-closed', () => app.quit());
let exiting = false;
app.on('before-quit', event => {
  if (exiting) return;
  event.preventDefault(); exiting = true;
  singleAction?.abort();
  void (async () => {
    await runtime.runPromise(TaskRunner.use(r => Effect.sync(() => r.revoke()))).catch(() => {});
    if (running) await Effect.runPromise(Fiber.interrupt(running));
    await singlePending;
    await runtime.dispose(); await traceChain; app.quit();
  })();
});
});
