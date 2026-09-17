import { Effect, ManagedRuntime, Schema } from 'effect';
import { DesktopDriver, driverLayer } from '../main/driver.js';
import { runDesktopGoal, taskDecider } from './task.js';
import { installHarnessSkill } from './install-skill.js';
import { dirname } from 'node:path';
import { ensureSession, secureDirectory, serveSocket, socketPath, socketRequest } from './socket.js';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { connection, harnessInstructions, loadCredential, settingsPath } from './harness.js';
import { runSession } from './session.js';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createDesktopTool } from './service.js';

const help = `jev-desktop — Jev computer-use tools for your coding agent

  skill codex|claude             Install direct shell-tool skill for your existing agent
  COMMAND --session NAME        Call from your current coding agent shell; keeps refs alive
  stop --session NAME           Stop that desktop helper
  connect codex|claude           Register MCP with your local coding agent
  config codex|claude            Print connection config without modifying it
  doctor                         Check native driver, saved key, and permissions
  session                        Persistent JSONL tool protocol over stdin/stdout
  instructions                   Print coding-agent usage instructions
  installed_apps                List launchable installed apps
  launch --app NAME_OR_BUNDLE_ID Open an installed app without activation
  windows --app NAME_OR_PID      List accessible native windows
  status                         Check permissions and TypeSafe configuration
  apps                           List running Mac apps
  permission                     Request Accessibility permission
  capture --app NAME --input-json '{"outputPath":"/tmp/jev-window.png"}'
                                Save a fresh window screenshot for your host agent
  detect_image --input-json '{"imagePath":"/path/to/image.png","overlay":true}'
                                Local YOLO/OCR on a file; no live input
  observe --visual --app NAME     Merge Accessibility with local YOLO and OCR
      [--model-path /path/model.mlpackage]
  observe --app NAME_OR_PID      Read the app's accessibility tree
  task --app NAME --instruction "Complete this goal; use exact value \"value\""
                                Run observe/decide/act loop; streams JSONL, no step cap
  act --app NAME_OR_PID --instruction "Press Save"
      [--operation press|setValue|insertText] [--text "exact text"] [--dry-run]
  mcp                            Serve tools over MCP stdio

Requires macOS and a built native driver. Loads the key saved in the app automatically.
Only Jev selection needs a key. MCP/session preserve refs across calls;
one-shot invocations do not share refs. Use MCP for Codex/Claude.
Actions execute immediately. act performs one action; task runs until completion or a blocker.
`;
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  visual: { type: 'boolean' }, overlay: { type: 'boolean' }, 'model-path': { type: 'string' },
  session: { type: 'string' },
  'input-json': { type: 'string' },
  app: { type: 'string' }, instruction: { type: 'string' }, operation: { type: 'string' },
  text: { type: 'string' }, 'window-id': { type: 'string' }, 'node-limit': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} });
const command = positionals[0];
if (!command || values.help) { console.log(help); process.exit(0); }
const entry = fileURLToPath(import.meta.url);
if (command === 'skill') {
  console.log(JSON.stringify(await installHarnessSkill(positionals[1] ?? '', process.execPath, entry)));
  process.exit(0);
}
if (command === 'instructions') { console.log(harnessInstructions); process.exit(0); }
if (command === 'connect' || command === 'config') {
  try {
    const config = connection(positionals[1] ?? '', process.execPath, entry, values.app);
    if (command === 'config') { console.log(JSON.stringify(config, null, 2)); process.exit(0); }
    if (process.platform !== 'darwin') throw new Error('Run connect on the Mac that will be controlled.');
    const result = spawnSync(config.command, config.args, { stdio: 'inherit', shell: false });
    if (result.error) throw new Error(`Could not run ${config.client}. Install it and put it on PATH.`);
    if (result.status !== 0) process.exit(result.status ?? 1);
    console.log('Connected jev-desktop. Start a new coding-agent session to load its tools.');
    process.exit(0);
  } catch (error) { console.error(error instanceof Error ? error.message : 'Connection failed'); process.exit(1); }
}
if (command === 'task') {
  const input = { ...values, ...(values['input-json'] ? JSON.parse(values['input-json']) : {}) };
  const goals: unknown = input.milestones ?? [input.instruction];
  if (!Array.isArray(goals) || goals.length === 0 || goals.some(goal => typeof goal !== 'string' || !goal.trim() || goal.length > 16000)) throw new Error('Supply one instruction or a nonempty milestones array of goal strings.');
  if (typeof input.app !== 'string' || !input.app.trim()) throw new Error('Task requires an exact app name.');
  if (process.env.JEV_ALLOWED_APP && process.env.JEV_ALLOWED_APP !== input.app) throw new Error('This session is scoped to another app.');
  await loadCredential();
  const runtime = ManagedRuntime.make(driverLayer(process.env.JEV_DRIVER_PATH ?? fileURLToPath(new URL('../native/macos/build/desktop-driver', import.meta.url))));
  const abort = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => abort.abort());
  try {
    for (const [index, goal] of (goals as string[]).entries()) {
      let succeeded = false;
      console.log(JSON.stringify({ state: 'milestone', index, total: (goals as string[]).length, message: goal }));
      await runDesktopGoal(goal, input.app,
        (method, args) => runtime.runPromise(Effect.flatMap(DesktopDriver, driver => driver.request(method, { ...args, animate: false })), { signal: abort.signal }),
        taskDecider(() => { if (!process.env.TYPESAFE_API_KEY) throw new Error('Missing TypeSafe API key.'); return process.env.TYPESAFE_API_KEY; }),
        event => { console.log(JSON.stringify(event)); if (event.state === 'succeeded') succeeded = true; },
        abort.signal, input.text, { visual: input.visual, overlay: input.overlay, modelPath: input.modelPath ?? input['model-path'] });
      if (!succeeded) { process.exitCode = 2; break; }
    }
  } catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Task failed' })); process.exitCode = 1; }
  finally { await runtime.dispose(); }
  process.exit(process.exitCode ?? 0);
}
if (values.session && command !== '_serve') {
  try {
    const path = socketPath(entry, values.session);
    await secureDirectory(dirname(path));
    if (command !== 'stop') await ensureSession(path, entry, values.session);
    const args = { ...values, modelPath: values['model-path'], ...(values['input-json'] ? JSON.parse(values['input-json']) : {}),
      ...(values['window-id'] ? { windowId: Number(values['window-id']) } : {}),
      ...(values['node-limit'] ? { nodeLimit: Number(values['node-limit']) } : {}),
      ...(values['dry-run'] === undefined ? {} : { dryRun: values['dry-run'] }) };
    const result = await socketRequest(path, command === 'stop' ? '__stop' : command, args);
    await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(result) + '\n', error => error ? reject(error) : resolve()));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Session failed', code: error instanceof Error && 'code' in error ? error.code : 'ToolError', delivery: error instanceof Error && 'delivery' in error ? error.delivery : 'notDispatched' }));
    process.exit(1);
  }
}
const credential = await loadCredential();
const binary = process.env.JEV_DRIVER_PATH ?? fileURLToPath(new URL('../native/macos/build/desktop-driver', import.meta.url));
const { tool, close } = createDesktopTool(binary);
const write = (line: string) => new Promise<void>((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve()));
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) if (command !== '_serve') process.once(signal, () => { controller.abort(); void close().finally(() => process.exit(130)); });
if (command === '_serve') {
  if (!values.session) throw new Error('Missing session name');
  const path = socketPath(entry, values.session);
  await secureDirectory(dirname(path));
  await serveSocket(path, (method, args) => tool.call(method, args), close);
} else if (command === 'doctor') {
  let executable = false;
  try { await access(binary, constants.X_OK); executable = true; } catch {}
  let status: unknown, error: string | undefined;
  if (process.platform === 'darwin' && executable) {
    try { status = await tool.call('status', {}, controller.signal); } catch (failure) { error = failure instanceof Error ? failure.message : 'Driver unavailable'; }
  }
  console.log(JSON.stringify({ platform: process.platform, nativeDriver: { path: binary, executable }, settingsPath: settingsPath(), credential, status, error,
    next: process.platform !== 'darwin' ? 'Run on the Mac being controlled.' : !executable ? 'Run bun run build:native.' : 'Use connect codex or connect claude; grant Accessibility if status reports it missing.' }, null, 2));
  await close();
} else if (command === 'session') {
  try { await runSession(process.stdin, write, (method, args) => tool.call(method, args, controller.signal)); } finally { await close(); }
} else if (command === 'mcp') {
  const server = new Server({ name: 'jev-desktop', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: harnessInstructions });
  const verification = { visual: { type: 'boolean' }, modelPath: { type: 'string' }, overlay: { type: 'boolean' }, expectedOutput: { type: 'string', minLength: 1, maxLength: 4000, description: 'Optional exact output line to check in non-editable AXStaticText after dispatch. Readback is separate from delivery; alreadyPresent means no causal proof.' } };
  const app = { type: 'string', description: 'Exact running app name or PID.' };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: 'desktop_capture', description: 'Capture the exact selected window for the host reasoning agent. Requires optional Screen Recording. outputPath saves a new owner-only PNG on the controlled Mac; existing files are never overwritten. This is observation, not an action.', inputSchema: { type: 'object', properties: { app, outputPath: { type: 'string' }, windowId: { type: 'integer', minimum: 1 } }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_status', description: 'Read Mac permission status. No model credentials needed.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_installed_apps', description: 'List installed apps with exact names and bundle IDs for background launch.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_launch', description: 'Open an exact installed app name or bundle ID without foreground activation in default background mode. No shell commands. Then list windows and observe; a launch response does not prove a usable window.', inputSchema: { type: 'object', properties: { app }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_apps', description: 'List running Mac applications and PIDs.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_wait', description: 'Read-only polling for expected text in the same app/window. Defaults to exactLine matching, useful for verifying terminal output without mistaking the command for its result. Returns matched or notObserved plus fresh refs. Never repeats an action.', inputSchema: { type: 'object', properties: { ...verification, app, windowId: { type: 'integer', minimum: 1 }, outputOnly: { type: 'boolean', description: 'Require non-editable AXStaticText evidence, excluding input fields.' }, waitText: { type: 'string', minLength: 1, maxLength: 4000 }, match: { type: 'string', enum: ['exactLine','contains'] }, timeoutMs: { type: 'number', minimum: 0, maximum: 30000 } }, required: ['app','waitText'], additionalProperties: false } },
    { name: 'desktop_windows', description: 'List accessible window IDs and titles for an exact running app. Use these IDs to bind observations to a specific window.', inputSchema: { type: 'object', properties: { app }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_observe', description: 'Read fresh accessibility controls for an exact Mac app window. Supply windowId from desktop_windows to select a different window. Partial observations do not prove controls absent; increase nodeLimit up to 2500 when needed. visual=true adds local YOLO/OCR; no pixels go to Jev.', inputSchema: { type: 'object', properties: { ...verification, app, windowId: { type: 'integer', minimum: 1 }, nodeLimit: { type: 'integer', minimum: 100, maximum: 2500 } }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_click', description: 'Click the center of an EXACT observed accessibility ref. Default background mode posts directly to the owning app/window without moving the hardware cursor or activating the app. Requires current snapshotId and bound window geometry. Experimental app compatibility: verify the resulting state, never blindly replay. No global-input fallback.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string' } }, required: ['app','snapshotId','ref'], additionalProperties: false } },
    { name: 'desktop_type', description: 'Type exact caller-supplied text into the latest observed focused editable ref using app-directed background keyboard events. Does not use the clipboard or activate the app. Requires native proof of the exact receiving window/field; unsupported surfaces refuse. Verify the resulting field or terminal state.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 8000 } }, required: ['app','snapshotId','ref','text'], additionalProperties: false } },
    { name: 'desktop_key', description: 'Press one named key. Background mode requires snapshotId and the exact focused editable ref; input is directed to that app without activation. Use for Escape dismissal, keyboard navigation, or selecting text. Enter can submit: caller must authorize its consequence. Observe result before retrying.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string', description: 'Required in background mode: current focused editable control.' }, key: { type: 'string', enum: ['Escape','Tab','Shift+Tab','Option+Tab','Option+Shift+Tab','Enter','Space','ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Backspace','Home','End','PageUp','PageDown','Meta+A'] } }, required: ['app','snapshotId','key'], additionalProperties: false } },
    { name: 'desktop_execute', description: 'Execute an EXACT control ref from the latest observation when the host reasoning agent has resolved the target. No Jev inference. Requires matching snapshotId; stale refs fail. Verify the returned fresh observation. Never replay unknown delivery.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string' }, operation: { type: 'string', enum: ['press', 'setValue', 'insertText'] }, text: { type: 'string', maxLength: 8000 } }, required: ['app', 'snapshotId', 'ref', 'operation'], additionalProperties: false } },
    { name: 'desktop_act', description: 'Immediately execute ONE semantic desktop action selected by Jev. Caller owns planning, permission and outcome verification. Supply exact text for editing. Returns fresh state; never automatically retries. Use dryRun to preview.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, candidateRefs: { type: 'array', minItems: 1, maxItems: 254, items: { type: 'string' }, description: 'Optional shortlist from the latest observation; requires its snapshotId. Jev chooses among these refs plus abstain.' }, instruction: { type: 'string', maxLength: 4000 }, operation: { type: 'string', enum: ['press', 'setValue', 'insertText'] }, text: { type: 'string', maxLength: 8000 }, dryRun: { type: 'boolean' } }, required: ['app', 'instruction'], additionalProperties: false } },
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      if (!['desktop_capture', 'desktop_status', 'desktop_apps', 'desktop_installed_apps', 'desktop_launch', 'desktop_observe', 'desktop_act', 'desktop_execute', 'desktop_key', 'desktop_click', 'desktop_type', 'desktop_windows', 'desktop_wait'].includes(request.params.name)) throw new Error('Unknown tool');
      const result = await tool.call(request.params.name.slice(8), request.params.arguments ?? {}, extra.signal);
      if (request.params.name === 'desktop_capture' && !request.params.arguments?.outputPath) {
        const capture = Schema.decodeUnknownSync(Schema.Struct({ snapshot: Schema.Unknown, image: Schema.Struct({ base64: Schema.String }) }))(result);
        return { content: [{ type: 'text', text: JSON.stringify(capture.snapshot) }, { type: 'image', data: capture.image.base64, mimeType: 'image/png' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) { const message = error instanceof Error ? error.message : 'Tool failed';
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'ToolError';
      const delivery = error instanceof Error && 'delivery' in error ? String(error.delivery) : 'notDispatched';
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: { code, message, delivery } }) }] }; }
  });
  server.onclose = () => { void close(); };
  await server.connect(new StdioServerTransport());
} else {
  try {
    const result = await tool.call(command, { ...values, modelPath: values['model-path'], ...(values['input-json'] ? JSON.parse(values['input-json']) : {}), ...(values['window-id'] ? { windowId: Number(values['window-id']) } : {}), ...(values['node-limit'] ? { nodeLimit: Number(values['node-limit']) } : {}), ...(values['dry-run'] === undefined ? {} : { dryRun: values['dry-run'] }) }, controller.signal);
    const output = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    await new Promise<void>((resolve, reject) => { process.stdout.write(output, error => error ? reject(error) : resolve()); });
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Command failed' })); process.exitCode = 1;
  } finally { await close(); }
}
