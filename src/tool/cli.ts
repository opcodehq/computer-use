import { inspectSurface } from './inspect.js';
import { BrowserTools, browserOperations } from '../browser/tools.js';
import { DesktopViewer } from '../viewer/server.js';
import { captureWindow } from '../linux/capture.js';
import type { Snapshot } from '../shared/contracts.js';
import { join } from 'node:path';
import { DriverSession } from './driver-session.js';
import { createDecisionModel, modelConfig, modelDecider, modelProviders } from './model.js';
import { openAgent } from './agent.js';
import { openTaskPreview } from './preview.js';
import { compiled, resourcePaths } from './runtime.js';
import { authenticate } from './auth.js';
import { Effect, ManagedRuntime, Schema } from 'effect';
import { DesktopDriver, driverLayer } from '../main/driver.js';
import { runDesktopGoal, taskDecider } from './task.js';
import { installHarnessSkill } from './install-skill.js';
import { readiness, formatReadiness } from './doctor.js';
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

const help = `cu — @opcodehq/cu native computer driver for your existing agent (jev alias supported)

Your agent plans and calls these tools using its existing login. No CU model key needed.
  inspect --input-json JSON     Auto-select native AX/vision or an explicitly bound browser page
  cu install                    npm distribution: build native runtime in user cache
  capture-permission            Request capture access for the Mac helper
  helper-restart                Stop the Mac helper; next call starts it again
  cu desktop -- COMMAND [ARGS]   npm distribution: start an isolated Linux display

  update                        Download and verify the latest published Mac bundle
  setup codex|claude|both        Install the skill and report readiness
  skill codex|claude|both        Install or update only the skill
  skill generic --dir PATH      Install the same skill in another agent’s directory
  COMMAND --session NAME        Call from your current coding agent shell; keeps refs alive
  pause --session NAME          Cancel input and pause this driver session
  resume --session NAME         Resume after an explicit user request
  stop --session NAME           Close that desktop helper
  connect codex|claude           Register MCP with your local coding agent
  config codex|claude|generic    Print connection config without modifying it
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
  observe --app NAME_OR_PID      Read native controls or Linux YOLO/OCR regions
  input --session NAME --app APP --snapshot-id ID --input-json ACTION_JSON
                                Linux: click/type/key/scroll on its isolated display
  execute --session NAME --app APP --snapshot-id ID --ref REF --operation press
  execute --session NAME --app APP --snapshot-id ID --ref REF --operation setValue --text TEXT
  key --session NAME --app APP --snapshot-id ID --ref REF --key Enter
                                Exact native actions; your agent chooses fresh targets

  browser --session NAME --input-json '{"operation":"open"}'
                                Session-owned tabs, frames, dialogs and file transfers
  viewer --session NAME [--app APP]
                                Live stream, read-only sharing, Stop and takeover

Optional model delegation (separate credentials):
  auth [--stdin]                Save a TypeSafe key only for optional Jev selection
  task --app NAME --instruction "Complete this goal; use exact value \"value\""
                                Run full workflow; popup preview on Mac (--no-preview hides it)
  providers                     List built-in decision providers and key environment variables
  task --provider NAME --model ID [--base-url URL] [--api-key-env ENV_NAME]
                                Use Vercel AI SDK models; no Jev or TypeSafe key
  task --agent-command PATH [--agent-args '["arg"]']
                                Use another agent through a persistent JSONL adapter; no TypeSafe key
  act --app NAME_OR_PID --instruction "Press Save"
      [--operation press|setValue|insertText] [--text "exact text"] [--dry-run]
  mcp                            Serve tools over MCP stdio

Native tools require macOS or an isolated Linux X11 desktop and a built driver (cu install). Browser tools require Chrome/Chromium.
Only Jev selection needs a TypeSafe key; SDK models use their provider credentials. MCP/session preserve refs across calls;
one-shot invocations do not share refs. Skills are the default for Codex/Claude.
After installing: cu permission, then cu setup codex|claude|both.
Other agents: cu instructions or cu config generic. Model delegation is opt-in.
Actions execute immediately. act performs one action; task runs until completion or a blocker.
`;
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  provider: { type: 'string' }, model: { type: 'string' }, 'base-url': { type: 'string' }, 'api-key-env': { type: 'string' },
  'agent-command': { type: 'string' }, 'agent-args': { type: 'string' },
  'no-preview': { type: 'boolean' },
  'snapshot-id': { type: 'string' }, ref: { type: 'string' }, key: { type: 'string' },
  stdin: { type: 'boolean' },
  visual: { type: 'boolean' }, overlay: { type: 'boolean' }, 'model-path': { type: 'string' },
  session: { type: 'string' }, dir: { type: 'string' },
  'input-json': { type: 'string' },
  app: { type: 'string' }, instruction: { type: 'string' }, operation: { type: 'string' },
  text: { type: 'string' }, 'window-id': { type: 'string' }, 'node-limit': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} });
const command = positionals[0];
if (!command || command === 'help' || values.help) { console.log(help); process.exit(0); }
if (command === 'providers') {
  console.log(JSON.stringify({ jev: { keyEnv: 'TYPESAFE_API_KEY', description: 'Optional typed decision backend; default for task.' }, ...modelProviders }, null, 2));
  process.exit(0);
}
if (command !== 'task' && [values.provider, values.model, values['base-url'], values['api-key-env'], values['agent-command'], values['agent-args']].some(value => value !== undefined)) {
  console.error('Decision-model options apply to task. Exact native tools use your host agent; act uses Jev.'); process.exit(1);
}
const entry = compiled ? process.execPath : fileURLToPath(import.meta.url);
if (command === 'update') {
  if (!compiled) { console.error('For a source checkout, update the checkout and run bun run build:cli.'); process.exit(1); }
  if (process.platform !== 'darwin') { console.error('CU native releases currently support macOS.'); process.exit(1); }
  const result = spawnSync('/bin/sh', [resourcePaths(entry).installer], { stdio: 'inherit', shell: false });
  if (result.error) console.error(result.error.message);
  if (result.status === 0) console.log('Run cu skill both to refresh installed harness paths.');
  process.exit(result.status ?? 1);
}
if (command === 'auth') {
  try { await authenticate(values.stdin === true); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Authentication setup failed'); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}
const installations: Awaited<ReturnType<typeof installHarnessSkill>>[] = [];
if (command === 'skill' || command === 'setup') {
  try {
    if (command === 'setup' && process.platform !== 'darwin') throw new Error('Run setup on the Mac being controlled. Use bun run setup codex|claude|both there.');
    const client = positionals[1] ?? (values.dir ? 'generic' : undefined);
    if (!client || !['codex', 'claude', 'both', 'generic'].includes(client)) throw new Error('Choose codex, claude, both, or generic --dir PATH.');
    for (const target of client === 'both' ? ['codex', 'claude'] : [client]) {
      installations.push(await installHarnessSkill(target, process.execPath, entry, undefined, values.dir));
    }
    if (command === 'skill') {
      console.log(JSON.stringify({ installations, next: 'Skill installed. Run doctor to check readiness. Ask your current agent to read the installed SKILL.md, or start a new session.' }, null, 2));
      process.exit(0);
    }
  } catch (error) { console.error(error instanceof Error ? error.message : 'Installation failed'); process.exit(1); }
}
if (command === 'instructions') { console.log(harnessInstructions); process.exit(0); }
if (command === 'connect' || command === 'config') {
  try {
    const config = connection(positionals[1] ?? '', process.execPath, entry, values.app);
    if (command === 'config') { console.log(JSON.stringify(config, null, 2)); process.exit(0); }
    if (config.client === 'generic') throw new Error('Use cu config generic and add its mcpServers entry in your client.');
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
  const agentArgs: unknown = input['agent-args'] ? JSON.parse(input['agent-args']) : [];
  if (!Array.isArray(agentArgs) || agentArgs.some(arg => typeof arg !== 'string')) throw new Error('--agent-args must be a JSON string array.');
  if (input['agent-args'] && !input['agent-command']) throw new Error('--agent-args requires --agent-command.');
  const selectedModel = modelConfig(input);
  const sdkDecide = selectedModel ? modelDecider(createDecisionModel(selectedModel)) : undefined;
  if (!input['agent-command'] && !selectedModel) await loadCredential();
  const agent = input['agent-command'] ? openAgent(input['agent-command'], agentArgs as string[]) : undefined;
  const decide = sdkDecide ?? agent?.decide ?? taskDecider(() => { if (!process.env.TYPESAFE_API_KEY) throw new Error('Missing TypeSafe API key.'); return process.env.TYPESAFE_API_KEY; });
  const runtime = ManagedRuntime.make(driverLayer(process.env.JEV_DRIVER_PATH ?? resourcePaths(entry).driver));
  const abort = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => abort.abort());
  const preview = process.platform === 'darwin' && !input['no-preview']
    ? await openTaskPreview(resourcePaths(entry).preview, () => abort.abort(), message => console.error(JSON.stringify({ warning: message }))) : undefined;
  preview?.send({ state: 'starting', message: `Working in ${input.app}. Close this panel to hide it; Stop cancels the task.` });
  try {
    for (const [index, goal] of (goals as string[]).entries()) {
      let succeeded = false;
      console.log(JSON.stringify({ state: 'milestone', index, total: (goals as string[]).length, message: goal }));
      await runDesktopGoal(goal, input.app,
        (method, args) => runtime.runPromise(Effect.flatMap(DesktopDriver, driver => driver.request(method, { ...args, animate: false })), { signal: abort.signal }),
        decide,
        event => { console.log(JSON.stringify(event)); preview?.send(event); if (event.state === 'succeeded') succeeded = true; },
        abort.signal, input.text, { visual: input.visual, overlay: input.overlay, modelPath: input.modelPath ?? input['model-path'] });
      if (!succeeded) { process.exitCode = 2; break; }
    }
  } catch (error) {
    const message = abort.signal.aborted ? 'Task stopped.' : error instanceof Error ? error.message : 'Task failed';
    preview?.send({ state: abort.signal.aborted ? 'stopped' : 'failed', message });
    console.error(JSON.stringify({ error: message })); process.exitCode = abort.signal.aborted ? 2 : 1;
  }
  finally { await agent?.close(); await runtime.dispose(); await preview?.close(); }
  process.exit(process.exitCode ?? 0);
}
if (values.session && command !== '_serve') {
  try {
    const path = socketPath(entry, values.session);
    await secureDirectory(dirname(path));
    if (command !== 'stop') await ensureSession(path, entry, values.session);
    const args = { ...values, snapshotId: values['snapshot-id'], modelPath: values['model-path'], ...(values['input-json'] ? JSON.parse(values['input-json']) : {}),
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
const binary = process.env.JEV_DRIVER_PATH ?? resourcePaths(entry).driver;
let target: Snapshot | undefined;
let browserView = false;
let viewer: DesktopViewer | undefined;
const browser = new BrowserTools({ headless: process.platform === 'darwin', ...(process.env.CU_BROWSER_NO_SANDBOX === '1' ? { args: ['--no-sandbox'] } : {}) });
browser.activity=(message,pointer)=>viewer?.activity(message,pointer);
const { tool: nativeTool, close: closeNative } = createDesktopTool(binary, event => { if(event.snapshot) target=event.snapshot; tool.event(event); });
const tool: DriverSession = new DriverSession(async(method,args,signal): Promise<unknown>=>{
  if(method==='inspect') { browserView=Boolean(args.pageId)||args.route==='browser'; return inspectSurface((m,a,s)=>nativeTool.call(m,a,s),(_m,a,s)=>browser.call(a,s),args,signal); }
  if(method==='browser') { browserView=true; return browser.call(args,signal); }
  if(method==='viewer') {
    if(args.app){browserView=false;target=await nativeTool.call('observe',args,signal) as Snapshot;}
    viewer ??= new DesktopViewer({
      status:()=>browserView ? browser.status() : {},
      binding:()=>browserView ? 'browser:'+browser.status().pageId : 'native:'+target?.pid+':'+target?.windowId,
      capture: async()=> {if(browserView)return browser.capture();if(process.platform!=='linux'||!target?.windowId)throw new Error('Observe a Linux window or open a session browser first.');return captureWindow(join(dirname(binary),'cu-x11'),target.windowId);},
      pause:()=>tool.stop(), resume:()=>tool.call('resume',{}),
      input:action=>tool.manual(async()=>{
        if(browserView)return browser.humanInput(action);
        if(!target)throw new Error('No selected window.');
        const app=String(target.pid),windowId=target.windowId;
        const snapshot=await nativeTool.call('observe',{app,windowId}) as Snapshot;
        return nativeTool.call('input',{app,windowId,snapshotId:snapshot.id,action});
      }),
    });
    const info=await viewer.open();
    viewer.event({state:'waiting',message:'Live session. Your agent has control.',...(browserView?{}:{snapshot:target})});
    return info;
  }
  if(!['pause','resume','status'].includes(method))browserView=false;
  return nativeTool.call(method,args,signal);
}, async stop =>
  process.platform === 'darwin' && !values['no-preview']
    ? openTaskPreview(resourcePaths(entry).preview, stop, message => console.error(JSON.stringify({ warning: message }))) : undefined, event=>viewer?.event(event));
const close = async () => { await viewer?.close(); await browser.close(); await tool.close(); await closeNative(); };
const write = (line: string) => new Promise<void>((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve()));
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) if (command !== '_serve') process.once(signal, () => { controller.abort(); void close().finally(() => process.exit(130)); });
if (command === '_serve') {
  if (!values.session) throw new Error('Missing session name');
  const path = socketPath(entry, values.session);
  await secureDirectory(dirname(path));
  await serveSocket(path, (method, args) => tool.call(method, args), close);
} else if (command === 'doctor' || command === 'setup') {
  let executable = false;
  try { await access(binary, constants.X_OK); executable = true; } catch {}
  let status: unknown, error: string | undefined;
  if (['darwin', 'linux'].includes(process.platform) && executable) {
    try { status = await tool.call('status', {}, controller.signal); } catch (failure) { error = failure instanceof Error ? failure.message : 'Driver unavailable'; }
  }
  const report = readiness({ platform: process.platform, executable, credential, status, error });
  if (command === 'setup') {
    console.log('\nJev skill installed:');
    for (const installation of installations) console.log(`  ${installation.client}: ${installation.skill}`);
    console.log(`\n${formatReadiness(report)}`);
    console.log(report.ready ? '\nNative tools ready. Ask your existing agent to use cu; no model setup needed.' : '\nInstalled; finish the required items above, then run jev doctor.');
    console.log('\nIn your coding agent, ask: “Use jev-desktop to inspect my running Mac apps without changing anything.”');
    console.log('If it cannot find the skill, ask it to read the SKILL.md path above, or start a new session.');
    if (!report.ready) process.exitCode = 2;
  } else {
    console.log(JSON.stringify({ ...report, platform: process.platform, nativeDriver: { path: binary, executable }, settingsPath: settingsPath(), credential, status, error }, null, 2));
    if (!report.ready) process.exitCode = 2;
  }
  await close();
} else if (command === 'session') {
  try { await runSession(process.stdin, write, (method, args) => tool.call(method, args, controller.signal)); } finally { await close(); }
} else if (command === 'mcp') {
  const server = new Server({ name: 'jev-desktop', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: harnessInstructions });
  const verification = { visual: { type: 'boolean' }, modelPath: { type: 'string' }, overlay: { type: 'boolean' }, expectedOutput: { type: 'string', minLength: 1, maxLength: 4000, description: 'Optional exact output line to check in non-editable AXStaticText after dispatch. Readback is separate from delivery; alreadyPresent means no causal proof.' } };
  const app = { type: 'string', description: 'Exact running app name or PID.' };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: 'desktop_inspect', description: 'Automatically inspect an exact attached browser page or a native app. Sparse native Accessibility falls back to local OCR and visual detection. Returns the chosen route and actionable next steps when capture permission is missing. Never guesses a tab from an app name.', inputSchema: {type:'object',properties:{app,pageId:{type:'string'},frameId:{type:'string'},windowId:{type:'integer'},route:{enum:['auto','ax','vision','browser']},query:{type:'string'},modelPath:{type:'string'}},additionalProperties:false} },
    { name: 'desktop_pointer', description: 'Double-click, right-click, hover or drag between fresh observed refs. Mac uses app-directed background events; Linux uses its isolated display. Returns fresh observation. Mac compatibility remains app-dependent.', inputSchema: {type:'object',properties:{app,snapshotId:{type:'string'},ref:{type:'string'},targetRef:{type:'string'},gesture:{enum:['doubleClick','rightClick','hover','drag']}},required:['app','snapshotId','ref','gesture'],additionalProperties:false} },
    { name: 'desktop_browser', description: 'Operate the session-owned browser without desktop pointer/focus changes. Open first, then list tabs and frames. Observe returns page/frame-bound refs and snapshotId. Handles dialogs, file inputs and downloads. attach connects an explicit local CDP endpoint; select the exact returned pageId. detach preserves existing tabs and the external browser. Mutations require checking the resulting page.', inputSchema: { type: 'object', properties: { endpoint:{type:'string'}, operation: { enum: browserOperations }, pageId: {type:'string'}, frameId:{type:'string'}, snapshotId:{type:'string'}, ref:{type:'string'}, targetRef:{type:'string'}, url:{type:'string'}, text:{type:'string'}, key:{type:'string'}, amount:{type:'number'}, value:{type:'string'}, paths:{type:'array',items:{type:'string'}}, dialogId:{type:'string'}, accept:{type:'boolean'}, downloadId:{type:'string'}, outputPath:{type:'string'} },required:['operation'],additionalProperties:false } },
    { name: 'desktop_viewer', description: 'Start a live viewer for the session browser or selected Linux app. Returns a private control link and a separate read-only sharing link. Keep this session alive. Viewer takeover pauses agent writes.', inputSchema: { type:'object',properties:{app,windowId:{type:'integer'}},additionalProperties:false } },
    { name: 'desktop_input', description: 'Input in an isolated Linux desktop using the latest screenshot. Coordinates are local to the captured window. Returns fresh state; verify the outcome.', inputSchema: { type: 'object', properties: { app, snapshotId: { type: 'string' }, action: { type: 'object', properties: { kind: { enum: ['click','doubleClick','rightClick','hover','drag','type','key','scroll'] }, x: { type: 'number' }, y: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' }, delivery: { enum: ['isolated','background'] }, text: { type: 'string' }, amount: { type: 'integer' } }, required: ['kind'], additionalProperties: false } }, required: ['app','snapshotId','action'], additionalProperties: false } },
    { name: 'desktop_pause', description: 'Cancel current input and pause this connection. Observations remain available.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_resume', description: 'Resume input only after the user asks to continue; then observe before acting.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_capture', description: 'Capture the exact selected window for the host reasoning agent. Requires optional Screen Recording. outputPath saves a new owner-only PNG on the controlled Mac; existing files are never overwritten. This is observation, not an action.', inputSchema: { type: 'object', properties: { app, outputPath: { type: 'string' }, windowId: { type: 'integer', minimum: 1 } }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_status', description: 'Read Mac permission status. No model credentials needed.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_installed_apps', description: 'List installed apps with exact names and bundle IDs for background launch.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_launch', description: 'Open an exact installed app name or bundle ID without foreground activation in default background mode. No shell commands. Then list windows and observe; a launch response does not prove a usable window.', inputSchema: { type: 'object', properties: { app }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_apps', description: 'List running Mac applications and PIDs.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'desktop_wait', description: 'Read-only polling for expected text in the same app/window. Defaults to exactLine matching, useful for verifying terminal output without mistaking the command for its result. Returns matched or notObserved plus fresh refs. Never repeats an action.', inputSchema: { type: 'object', properties: { ...verification, app, windowId: { type: 'integer', minimum: 1 }, outputOnly: { type: 'boolean', description: 'Require non-editable AXStaticText evidence, excluding input fields.' }, waitText: { type: 'string', minLength: 1, maxLength: 4000 }, match: { type: 'string', enum: ['exactLine','contains'] }, timeoutMs: { type: 'number', minimum: 0, maximum: 30000 } }, required: ['app','waitText'], additionalProperties: false } },
    { name: 'desktop_windows', description: 'List accessible window IDs and titles for an exact running app. Use these IDs to bind observations to a specific window.', inputSchema: { type: 'object', properties: { app }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_observe', description: 'Read fresh accessibility controls for an exact Mac app window. Supply windowId from desktop_windows to select a different window. Partial observations do not prove controls absent; increase nodeLimit up to 2500 when needed. visual=true adds local YOLO/OCR; no pixels go to Jev.', inputSchema: { type: 'object', properties: { ...verification, app, windowId: { type: 'integer', minimum: 1 }, nodeLimit: { type: 'integer', minimum: 100, maximum: 2500 } }, required: ['app'], additionalProperties: false } },
    { name: 'desktop_click', description: 'Activate an EXACT observed ref. Background mode uses AXPress for off-screen or geometry-free controls that advertise it; otherwise it uses window-directed pointer delivery. Off-screen pointer refusal returns recoveryRequired with fresh Accessibility controls so the host can continue the goal through a supported semantic route. Requires current snapshotId. Verify the resulting state; no global-input or automatic Space-switch fallback.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string' } }, required: ['app','snapshotId','ref'], additionalProperties: false } },
    { name: 'desktop_type', description: 'Type exact caller-supplied text into the latest observed focused editable ref using app-directed background keyboard events. Does not use the clipboard or activate the app. Requires native proof of the exact receiving window/field; unsupported surfaces refuse. Verify the resulting field or terminal state.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 8000 } }, required: ['app','snapshotId','ref','text'], additionalProperties: false } },
    { name: 'desktop_key', description: 'Press one named key. Background mode requires snapshotId and the exact focused editable ref; input is directed to that app without activation. Use for Escape dismissal, keyboard navigation, or selecting text. Enter can submit: caller must authorize its consequence. Observe result before retrying.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string', description: 'Required in background mode: current focused editable control.' }, key: { type: 'string', enum: ['Escape','Tab','Shift+Tab','Option+Tab','Option+Shift+Tab','Enter','Space','ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Backspace','Home','End','PageUp','PageDown','Meta+A'] } }, required: ['app','snapshotId','key'], additionalProperties: false } },
    { name: 'desktop_execute', description: 'Execute an EXACT control ref from the latest observation when the host reasoning agent has resolved the target. No Jev inference. Requires matching snapshotId; stale refs fail. Verify the returned fresh observation. Never replay unknown delivery.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, ref: { type: 'string' }, operation: { type: 'string', enum: ['press', 'setValue', 'insertText'] }, text: { type: 'string', maxLength: 8000 } }, required: ['app', 'snapshotId', 'ref', 'operation'], additionalProperties: false } },
    { name: 'desktop_act', description: 'Immediately execute ONE semantic desktop action selected by Jev. Caller owns planning, permission and outcome verification. Supply exact text for editing. Returns fresh state; never automatically retries. Use dryRun to preview.', inputSchema: { type: 'object', properties: { ...verification, app, snapshotId: { type: 'string' }, candidateRefs: { type: 'array', minItems: 1, maxItems: 254, items: { type: 'string' }, description: 'Optional shortlist from the latest observation; requires its snapshotId. Jev chooses among these refs plus abstain.' }, instruction: { type: 'string', maxLength: 4000 }, operation: { type: 'string', enum: ['press', 'setValue', 'insertText'] }, text: { type: 'string', maxLength: 8000 }, dryRun: { type: 'boolean' } }, required: ['app', 'instruction'], additionalProperties: false } },
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      if (!['desktop_inspect', 'desktop_pointer', 'desktop_browser', 'desktop_viewer', 'desktop_pause', 'desktop_resume', 'desktop_input', 'desktop_capture', 'desktop_status', 'desktop_apps', 'desktop_installed_apps', 'desktop_launch', 'desktop_observe', 'desktop_act', 'desktop_execute', 'desktop_key', 'desktop_click', 'desktop_type', 'desktop_windows', 'desktop_wait'].includes(request.params.name)) throw new Error('Unknown tool');
      const result = await tool.call(request.params.name.slice(8), request.params.arguments ?? {}, extra.signal);
      if (request.params.name === 'desktop_inspect' && result && typeof result === 'object' && 'image' in result) {
        const { image, ...observation } = result as { image: {base64:string}; [key:string]:unknown };
        return { content: [{type:'text',text:JSON.stringify(observation)}, {type:'image',data:image.base64,mimeType:'image/png'}] };
      }
      if ((request.params.name === 'desktop_capture' && !request.params.arguments?.outputPath) || (request.params.name === 'desktop_browser' && request.params.arguments?.operation === 'capture')) {
        const capture = Schema.decodeUnknownSync(Schema.Struct({ snapshot: Schema.optional(Schema.Unknown), image: Schema.Struct({ base64: Schema.String }) }))(result);
        return { content: [{ type: 'text', text: JSON.stringify(capture.snapshot ?? { kind: 'browserCapture' }) }, { type: 'image', data: capture.image.base64, mimeType: 'image/png' }] };
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
    const result = await tool.call(command, { ...values, snapshotId: values['snapshot-id'], modelPath: values['model-path'], ...(values['input-json'] ? JSON.parse(values['input-json']) : {}), ...(values['window-id'] ? { windowId: Number(values['window-id']) } : {}), ...(values['node-limit'] ? { nodeLimit: Number(values['node-limit']) } : {}), ...(values['dry-run'] === undefined ? {} : { dryRun: values['dry-run'] }) }, controller.signal);
    const output = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    await new Promise<void>((resolve, reject) => { process.stdout.write(output, error => error ? reject(error) : resolve()); });
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Command failed' })); process.exitCode = 1;
  } finally { await close(); }
}
