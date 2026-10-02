import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSurface } from '../src/tool/inspect.js';
const snapshot = { id:'one', source:'ax', pid:1, windowId:5, title:'Aside', truncated:false, nodes:[] };
test('sparse AX triggers visual observation in the same window and preserves permission failure evidence', async()=>{
 const calls: Record<string,unknown>[]=[];
 const result=await inspectSurface(async(_m,a)=>{calls.push(a);return a.visual?{...snapshot,visual:{model:'unavailable',warning:'ScreenRecordingDenied'}}:snapshot;},async()=>{throw new Error('Must not guess a browser');},{app:'Aside'});
 assert.equal(calls.length,2);assert.equal(calls[1]?.windowId,5);assert.equal(result.route,'ax');assert.match(result.next!,/permission/);
});
test('explicit browser page bypasses native permission checks', async()=>{
 let page: unknown;
 const result=await inspectSurface(async()=>{throw new Error('No native call');},async(_m,a)=>{page=a.pageId;return {text:'No requests'};},{pageId:'exact-page'});
 assert.equal(page,'exact-page');assert.equal(result.route,'browser');
});
test('rich native text skips unnecessary capture, while a missing query requests vision',async()=>{
 const calls: unknown[]=[];
 const native=async(_m:string,a:Record<string,unknown>)=>{calls.push(a.visual);return {...snapshot,nodes:[{ref:'one:0',role:'AXStaticText',name:'The request inbox contains one pending request from Alex.',value:'',enabled:true,depth:0,actions:[]}]};};
 await inspectSurface(native,async()=>({}),{app:'Aside'});assert.deepEqual(calls,[false]);
 calls.length=0;await inspectSurface(native,async()=>({}),{app:'Aside',query:'billing'});assert.deepEqual(calls,[false,true]);
});
test('visual inspection returns the same capture for host vision alongside fresh visual refs',async()=>{
 const visual={...snapshot,visual:{model:'detector',regionCount:1,durationMs:1}};
 const result=await inspectSurface(async(_m,a)=>a.visual?{snapshot:visual,image:{base64:'fixture-image'}}:snapshot,async()=>({}),{app:'Aside'});
 assert.equal(result.route,'vision');assert('image' in result);assert.deepEqual(result.image,{base64:'fixture-image'});assert.equal(result.snapshot,visual);
});
