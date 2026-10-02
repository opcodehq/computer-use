import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const bundle=resolve('.context/browser-attach-tools.mjs');
await build({entryPoints:['src/browser/tools.ts'],outfile:bundle,bundle:true,packages:'external',platform:'node',format:'esm'});
const {BrowserTools}=await import(bundle+'?t='+Date.now());
const dir=await mkdtemp(join(tmpdir(),'cu-attach-'));
const chrome=spawn('google-chrome',['--headless=new','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+dir,'--no-first-run','about:blank'],{stdio:'ignore'});
let controller;const tool=new BrowserTools();
try {
 let port='';for(let i=0;i<100&&!port;i++){port=(await readFile(join(dir,'DevToolsActivePort'),'utf8').catch(()=>'' )).split('\n')[0]??'';if(!port)await delay(100);}
 assert(port,'Chrome debugging endpoint ready');
 controller=await chromium.connectOverCDP('http://127.0.0.1:'+port,{noDefaults:true,timeout:5000});
 const context=controller.contexts()[0],page=context.pages()[0];
 await context.addCookies([{name:'session-fixture',value:'preserve-me',domain:'example.com',path:'/'}]);
 await page.setContent('<main><div>One pending request from Alex</div><button onclick="this.textContent=\'Opened\'">Read request</button></main>');
 const attached=await tool.call({operation:'attach',endpoint:'http://127.0.0.1:'+port});const pageId=attached.tabs[0].id;
 const observed=await tool.call({operation:'observe',pageId});assert.match(observed.text,/One pending request/);
 const button=observed.nodes.find(n=>n.name==='Read request');assert(button);
 await tool.call({operation:'click',pageId,snapshotId:observed.snapshotId,ref:button.ref});assert.equal(await page.locator('button').innerText(),'Opened');
 const capture=await tool.call({operation:'capture',pageId});assert(capture.image.base64.length>100);
 await tool.call({operation:'detach'});assert.equal(page.isClosed(),false);assert.equal((await context.cookies('https://example.com'))[0].value,'preserve-me');
 await assert.rejects(tool.call({operation:'observe',pageId}),/Open the session browser/);
 console.log('PASS existing-browser DOM, action, screenshot, cookies and tab preservation on detach');
} finally {await tool.close();await controller?.close();chrome.kill('SIGTERM');await delay(300);await rm(dir,{recursive:true,force:true});}
