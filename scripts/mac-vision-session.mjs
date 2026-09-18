// Real Jev + CoreML + native input acceptance, through the already-permitted
// Electron host. Operates only on the disposable VisualTarget fixture.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.context/vision');
await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'jev-visual-'));
const bundle = join(temp, 'JevVisionFixture.app');
const executable = join(bundle, 'Contents/MacOS/JevVisionFixture');
await mkdir(join(bundle,'Contents/MacOS'),{recursive:true});
await writeFile(join(bundle,'Contents/Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>JevVisionFixture</string><key>CFBundleIdentifier</key><string>local.jev.visionfixture</string><key>CFBundleName</key><string>JevVisionFixture</string><key>LSUIElement</key><true/></dict></plist>`);
const result = join(temp, 'clicks.txt');
execFileSync('swiftc', [join(root, 'tests/fixtures/macos/VisualTarget.swift'), '-o', executable]);
execFileSync('open',['-g','-n',bundle,'--args',result]);
let fixturePID;
let ownsTask=false;
for(let i=0;i<40;i++){try{fixturePID=Number(await readFile(result+'.pid','utf8'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
if(!fixturePID)throw Error('Disposable fixture did not launch');
const inputState = () => JSON.parse(execFileSync(join(root, 'native/macos/build/desktop-driver'), { input: JSON.stringify({ id: 'input', method: 'inputState' })+'\n', encoding: 'utf8' })).data;
let browser;
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9228');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('/dist/renderer/index.html') && !p.url().includes('preview='));
  if (!page) throw Error('Main Jev window unavailable');
  await page.evaluate(() => { window.visionTestEvents = []; window.visionTestCleanup = window.desktop.onEvent(e => window.visionTestEvents.push(e)); });
  for(let i=0;i<40;i++){const found=await page.evaluate(async pid=>(await window.desktop.apps()).some(app=>app.pid===pid),fixturePID);if(found)break;if(i===39){const fresh=JSON.parse(execFileSync(join(root,'native/macos/build/desktop-driver'),{input:JSON.stringify({id:'apps',method:'apps'})+'\n',encoding:'utf8'})).data;throw Error(JSON.stringify({problem:'Fixture missing from persistent inventory',fixturePID,freshMatch:fresh.find(a=>a.pid===fixturePID)}));}await new Promise(r=>setTimeout(r,100));}
  const before = inputState();
  await page.evaluate(async pid => {
    const goal = 'Click the "Complete vision test" button once. Finish only when "VISION TEST PASSED" is visible.';
    document.getElementById('goal').value = goal;
    document.getElementById('local-visual').checked = true;
    document.getElementById('overlay').checked = true;
    await window.desktop.start({ goal, mode:'jev', pid, vision:false, autoActions:false, localVisual:true, overlay:true });
  }, fixturePID);
  ownsTask=true;
  const terminal = ['failed','stopped','succeeded','blocked','uncertain','completed'];
  await page.waitForFunction(states => window.visionTestEvents.some(e => states.includes(e.state)), terminal, { timeout: 90000 });
  ownsTask=false;
  const after = inputState();
  const events = await page.evaluate(() => window.visionTestEvents);
  await writeFile(join(evidence,'native-session.json'), JSON.stringify(events.map(({image,...event}) => event),null,2), { mode:0o600 });
  const image = events.findLast(e => e.image)?.image;
  if (image) await writeFile(join(evidence,'native-session.png'), Buffer.from(image,'base64'), {mode:0o600});
  let clicks=0;try { clicks=Number(await readFile(result,'utf8')); } catch {}
  const summary = { fixturePID, foregroundBefore:before.foregroundPID, foregroundAfter:after.foregroundPID, terminal:events.at(-1)?.state, message:events.at(-1)?.message, clicks, states:events.map(e=>e.state), foregroundUnchanged:before.foregroundPID===after.foregroundPID, cursorUnchanged:JSON.stringify(before.cursor)===JSON.stringify(after.cursor), hardwareMouseMoves:Number(after.hardwareMouseMoves)-Number(before.hardwareMouseMoves), visualModels:events.flatMap(e=>e.snapshot?.visual ? [e.snapshot.visual] : []) };
  console.log(JSON.stringify(summary));
  await writeFile(join(evidence,'native-summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
  if (clicks!==1 || summary.terminal!=='succeeded') process.exitCode=1;
} finally {
  if(browser) {
    const page=browser.contexts()[0].pages().find(p=>p.url().includes('/dist/renderer/index.html')&&!p.url().includes('preview='));
    await page?.evaluate(async cancel=>{window.visionTestCleanup?.();if(cancel)await window.desktop.stop();},ownsTask).catch(()=>{});
    await browser.close();
  }
  if(fixturePID)try{process.kill(fixturePID,'SIGTERM');}catch{}
  await rm(temp,{recursive:true,force:true});
}
