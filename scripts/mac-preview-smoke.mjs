// Native UI acceptance. Reads and presses controls in our preview only.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'cu-preview-'));
const evidence = join(root, '.context/preview'); await mkdir(evidence, { recursive: true });
const image = join(evidence, 'cli-preview.png');
// Instrument only the test copy to render its own content view, without screen capture.
const original = await readFile(join(root, 'native/macos/TaskPreview.swift'), 'utf8');
const injected = original.replace('\n    }\n    @objc func stopTask()', `
        if let path = ProcessInfo.processInfo.environment["CU_PREVIEW_TEST_IMAGE"], !FileManager.default.fileExists(atPath:path), let view = panel.contentView {
            view.layoutSubtreeIfNeeded()
            if let bitmap = view.bitmapImageRepForCachingDisplay(in:view.bounds) {
                view.cacheDisplay(in:view.bounds,to:bitmap)
                try? bitmap.representation(using:.png,properties:[:])?.write(to:URL(fileURLWithPath:path))
            }
        }
    }
    @objc func stopTask()`);
assert.notEqual(injected, original);
await writeFile(join(temporary,'Preview.swift'), injected);
const binary = join(temporary,'task-preview-test');
execFileSync('xcrun', ['swiftc','-swift-version','5','-parse-as-library','-framework','AppKit',join(temporary,'Preview.swift'),'-o',binary]);
const driver = spawn(join(root,'native/macos/build/desktop-driver'), [], { stdio:['pipe','pipe','pipe'] });
const pending = new Map(); let sequence = 0;
createInterface({input:driver.stdout}).on('line', line=>{ const r=JSON.parse(line); const p=pending.get(r.id); if(p){ pending.delete(r.id);r.ok?p.resolve(r.data):p.reject(Error(JSON.stringify(r.error))); }});
function call(method,args={}){ return new Promise((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});driver.stdin.write(JSON.stringify({id,method,...args})+'\n');}); }
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
let preview;
try {
  const before = await call('inputState');
  preview=spawn(binary,[],{env:{...process.env,CU_PREVIEW_TEST_IMAGE:image},stdio:['pipe','pipe','pipe']});
  let output='';preview.stdout.on('data',d=>output+=d);
  preview.stdin.write(JSON.stringify({state:'acting',message:'Saving the project, then verifying the saved result.',title:'Project settings',snapshotId:'fixture',frame:{x:0,y:0,width:900,height:520},nodes:[{frame:{x:40,y:40,width:820,height:60},label:'Project settings'},{frame:{x:40,y:150,width:600,height:55},label:'Project name · Opcode QA'},{frame:{x:40,y:240,width:600,height:55},label:'Callback · https://example.test/callback'},{frame:{x:40,y:380,width:220,height:65},label:'Save project'}],target:{x:40,y:380,width:220,height:65},action:'press'})+'\n');
  let snapshot;
  for(let i=0;i<30;i++){await sleep(100);try{snapshot=await call('snapshot',{pid:preview.pid});if(snapshot.nodes.some(n=>n.name==='Stop'))break;}catch{}}
  const stop=snapshot?.nodes.find(n=>n.name==='Stop');assert.ok(stop,'Stop button should be accessible');
  const afterOpen=await call('inputState');
  assert.equal(afterOpen.foregroundPID,before.foregroundPID,'Preview stole foreground');
  assert.deepEqual(afterOpen.cursor,before.cursor,'Hardware cursor changed during preview opening');
  await call('execute',{snapshotId:snapshot.id,action:{kind:'press',ref:stop.ref}});
  await sleep(150);assert.equal(output.trim(),'{"stop":true}');
  preview.stdin.write(JSON.stringify({state:'stopped',message:'Task stopped by you.',terminal:true,target:null})+'\n');
  await sleep(150);snapshot=await call('snapshot',{pid:preview.pid});
  assert.equal(snapshot.nodes.find(n=>n.name==='Stop')?.enabled,false);
  const hide=snapshot.nodes.find(n=>n.name==='Hide preview');assert.ok(hide);
  const exit=new Promise(r=>preview.once('exit',r));
  await call('execute',{snapshotId:snapshot.id,action:{kind:'press',ref:hide.ref}});
  await Promise.race([exit,sleep(2500).then(()=>{throw Error('Preview did not close');})]);
  const summary={stopDeliveredOnce:true,stopDisabledAfterCompletion:true,closeHidesPreview:true,foregroundUnchanged:true,cursorUnchanged:true,renderedImage:image};
  await writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
} finally { preview?.kill();driver.kill();await rm(temporary,{recursive:true,force:true}); }
