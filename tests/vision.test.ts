import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseVisual, visualCandidates, addVisualObservation, type VisualObservation } from '../src/vision/observation.js';
import { validateCandidate } from '../src/main/policy.js';
import { runDesktopGoal } from '../src/tool/task.js';
import type { Snapshot, Event } from '../src/shared/contracts.js';
const snapshot: Snapshot = { id: 's', pid: 42, title: 'Fixture', source: 'ax', nodes: [], truncated: false };
const visual: VisualObservation = { snapshotId:'s', actionable:true, width:800, height:600, origin:{x:100,y:50}, model:'fixture',durationMs:12,regions:[{ref:'s:visual:0',label:'Save',source:'yolo',confidence:.9,bounds:{x:20,y:30,width:80,height:30}}] };
test('fuses window-local detections into screen coordinates and validates grounded clicks', () => {
  const combined = fuseVisual(snapshot,visual);
  assert.deepEqual(combined.nodes[0]?.frame,{x:120,y:80,width:80,height:30});
  validateCandidate(visualCandidates(combined)[0]!,combined,false);
  assert.throws(()=>validateCandidate(visualCandidates(combined)[0]!,{...combined,id:'new'},false));
});
test('rejects offline images and captures from other generations', () => {
  assert.throws(()=>fuseVisual(snapshot,{...visual,actionable:false}));
  assert.throws(()=>fuseVisual(snapshot,{...visual,snapshotId:'old'}));
  assert.throws(()=>fuseVisual(snapshot,{...visual,origin:undefined}));
});
test('prefers AX semantics and adds OCR labels only to unnamed controls', () => {
  const node = {ref:'s:0',role:'AXButton',name:'',value:'',enabled:true,actions:['AXPress'],depth:1,frame:{x:120,y:80,width:80,height:30}};
  const combined = fuseVisual({...snapshot,nodes:[node]},visual);
  assert.equal(combined.nodes.length,1); assert.equal(combined.nodes[0]?.name,'Save');
  assert.equal(visualCandidates(combined).length,0);
  assert.equal(fuseVisual({...snapshot,nodes:[{...node,name:'Authoritative'}]},visual).nodes[0]?.name,'Authoritative');
});
test('does not recover protected fields or malformed detections', () => {
  const protectedNode={ref:'s:0',role:'AXSecureTextField',name:'Password',value:'[secure]',enabled:true,actions:[],depth:1,frame:{x:120,y:80,width:80,height:30}};
  assert.equal(fuseVisual({...snapshot,nodes:[protectedNode]},visual).nodes.length,1);
  for (const region of [{...visual.regions[0]!,confidence:.1},{...visual.regions[0]!,confidence:NaN},{...visual.regions[0]!,ref:'stale:visual:0'},{...visual.regions[0]!,bounds:{x:-1,y:0,width:3,height:4}}]) {
    assert.equal(fuseVisual(snapshot,{...visual,regions:[region]}).nodes.length,0);
  }
});
test('denied capture keeps AX evidence with an explicit warning', async () => {
  const result=await addVisualObservation(snapshot,async()=>{throw Error('ScreenRecordingDenied');},{visual:true});
  assert.equal(result.snapshot.nodes,snapshot.nodes); assert.match(result.snapshot.visual!.warning!,/ScreenRecordingDenied/);
});
test('visual task verifies fresh state after dispatch; no screenshot is passed to decision model', async () => {
  let count=0;const calls:string[]=[];const events:Event[]=[];
  await runDesktopGoal('Save the fixture','42',async(method,args)=>{
    calls.push(method);
    if(method==='apps')return[{pid:42,name:'Fixture'}];
    if(method==='snapshot')return snapshot;
    if(method==='detect')return {...visual,image:'local-preview'};
    if(method==='execute')assert.deepEqual(args?.action,{kind:'visualClick',ref:'s:visual:0'});
    return{};
  },async(_goal,state,candidates)=>{
    assert.equal('image' in state,false);
    assert.ok(candidates.some(c=>c.action.kind==='visualClick'));
    return ++count===1?{operation:'press',target:'v0',confidence:1,complete:0}:{operation:'done',target:'none',confidence:1,complete:1};
  },e=>events.push(e),new AbortController().signal,undefined,{visual:true});
  assert.deepEqual(calls,['apps','snapshot','detect','execute','snapshot','detect']);
  assert.equal(events.at(-1)?.state,'succeeded');
  assert.ok(events.some(e=>e.image==='local-preview'));
});

test('capture saves a private new image and cannot overwrite an existing file', async () => {
  const { DesktopTool } = await import('../src/tool/service.js');
  const { mkdtemp, readFile, stat, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(),'jev-capture-'));
  const calls:string[]=[];
  const tool=new DesktopTool(async(method)=>{
    calls.push(method);
    if(method==='apps')return[{pid:42,name:'Fixture'}];
    if(method==='snapshot')return snapshot;
    if(method==='screenshot')return{base64:Buffer.from('fixture-png').toString('base64'),width:800,height:600};
    throw Error('Unexpected native call');
  });
  try {
    const path=join(dir,'capture.png');
    await tool.call('capture',{app:'Fixture',outputPath:path});
    assert.equal(await readFile(path,'utf8'),'fixture-png');
    assert.equal((await stat(path)).mode & 0o777,0o600);
    await assert.rejects(()=>tool.call('capture',{app:'Fixture',outputPath:path}),/EEXIST/);
    assert.equal(calls.includes('execute'),false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('scales Retina image pixels to window points before merging', () => {
  const result=fuseVisual(snapshot,{...visual,pointSize:{width:400,height:300}});
  assert.deepEqual(result.nodes[0]?.frame,{x:110,y:65,width:40,height:15});
  assert.throws(()=>fuseVisual(snapshot,{...visual,pointSize:{width:0,height:300}}));
});
