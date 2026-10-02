import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriverSession } from '../src/tool/driver-session.js';
import { DesktopTool } from '../src/tool/service.js';
import type { Event, Snapshot } from '../src/shared/contracts.js';
const snapshot: Snapshot = { id:'s',source:'ax',pid:42,title:'Fixture',truncated:false,nodes:[{ref:'s:0',name:'Save',role:'AXButton',value:'',actions:['AXPress'],enabled:true,depth:1,frame:{x:2,y:3,width:60,height:20}}] };

test('host-driven observe/action/readback uses a persistent preview and never selects a model', async () => {
  const events: Event[]=[]; let opens=0, closes=0, dispatched=0;
  const native = new DesktopTool(async method => {
    if(method==='apps') return [{pid:42,name:'Fixture'}];
    if(method==='snapshot') return snapshot;
    if(method==='execute') dispatched++;
    return {};
  }, async()=>{throw new Error('Unexpected model call');}, (state,candidate,snapshot)=>session.event({state,candidate,snapshot,message:state}));
  const session=new DriverSession((method,args,signal)=>native.call(method,args,signal),async()=>{opens++; return {send:event=>events.push(event),close:async()=>{closes++;}};});
  await session.call('observe',{app:'42'});
  await session.call('execute',{app:'42',snapshotId:'s',ref:'s:0',operation:'press'});
  assert.equal(opens,1);assert.equal(dispatched,1);
  assert.ok(events.some(event=>event.state==='acting'&&event.candidate?.action.ref==='s:0'&&event.snapshot?.id==='s'));
  assert.equal(events.at(-1)?.state,'waiting');
  assert.equal(events.at(-1)?.candidate,undefined);
  await session.close();assert.equal(closes,1);
});

test('preview Stop cancels in-flight input, stays paused, and requires explicit resume and fresh observation', async () => {
  let stop!:()=>void, started!:()=>void;
  const active=new Promise<void>(resolve=>started=resolve);
  const session=new DriverSession(async(method,_args,signal)=>{
    if(method==='observe') return snapshot;
    started();return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  },async callback=>{stop=callback;return {send:()=>{},close:async()=>{}};});
  await session.call('observe',{});
  const action=session.call('execute',{});await active;stop();
  await assert.rejects(action,error=>{assert.equal((error as {delivery:string}).delivery,'unknown');return true;});
  await assert.rejects(session.call('execute',{}),/paused/);
  assert.deepEqual(await session.call('observe',{}),snapshot);
  await session.call('resume',{});
  await assert.rejects(session.call('execute',{}),/Observe fresh/);
  await session.call('observe',{});
  await session.close();
});

test('preview stopped during opening cannot dispatch, and no-preview persists for the session', async()=>{
  let calls=0;
  const session=new DriverSession(async()=>{calls++;return snapshot;},async stop=>{stop();return undefined;});
  await assert.rejects(session.call('execute',{}),/stopped/);assert.equal(calls,0);
  let opens=0;
  const quiet=new DriverSession(async()=>snapshot,async()=>{opens++;return undefined;});
  await quiet.call('observe',{'no-preview':true});await quiet.call('observe',{});
  assert.equal(opens,0);await session.close();await quiet.close();
});
