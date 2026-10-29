import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const goals=JSON.parse(await readFile('benchmarks/fixtures/operations-goals.json','utf8'));
test('operations HTTP evaluator enforces saved readback, exact varied goals and immutable grading', {timeout:15000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'operations-test-'));
 const child=spawn(process.execPath,['benchmarks/fixtures/operations.cjs'],{env:{...process.env,PORT:'0',CU_FIXTURE_DIR:dir},stdio:['ignore','pipe','pipe']});
 try {
 const origin=await new Promise<string>((resolve,reject)=>{child.stdout.once('data',b=>resolve(String(b).trim()));child.once('error',reject);});
 const call=(u:string,v?:Record<string,string>)=>fetch(origin+u,v?{method:'POST',body:new URLSearchParams(v),redirect:'manual'}:{});
 for(const trial of ['1','2','3'])for(const task of ['project','triage','report']){
 const base=`/run/test/${task}/${trial}`, e=goals.trials[trial].tasks[task].expectedState;
 const grade=async()=>await(await call(base+'/grade')).json();
 assert.equal((await grade()).passed,false);
 await call(base+'/reset',{});
 if(task==='project'||task==='report'){
 assert.equal((await call(base+`/${task}?index=999`)).status,400);
 assert.equal((await call(base+`/${task}?index=-1`)).status,400);
 assert.equal((await call(base+`/${task}`)).status,400);
 if(task==='project')await call(base+'/project/review',e);
 else for(const page of [1,2])await call(base+`/renewals?region=North&status=Pending&page=${page}`);
 await call(base+`/${task}/save`,e);
 assert.equal((await grade()).checks.reopened,false);
 assert.equal((await call(base+`/${task}?index=1.5`)).status,400);
 await call(base+`/${task}?index=0`);
 }else{
 assert.equal((await call(base+'/record?id=OPS-999')).status,400);
 assert.equal((await call(base+'/record/save',{id:'OPS-999'})).status,400);
 for(const [id,v]of Object.entries(e)){
 await call(base+'/record?id='+id);
 await call(base+'/record/save',{id,...v as Record<string,string>});
 }
 assert.equal((await grade()).checks.reopened,false);
 for(const id of Object.keys(e))await call(base+'/record?id='+id);
 }
 const passing=await grade();assert.equal(passing.passed,true);
 const persisted=JSON.parse(await readFile(join(dir,'fixture.state.json'),'utf8'))[`test/${task}/${trial}`];
 if(task==='project')assert.deepEqual(persisted.projects,[e]);
 else if(task==='report')assert.deepEqual(persisted.reports,[e]);
 else for(const [id,v]of Object.entries(e)){const r=persisted.records.find((r:any)=>r.id===id);assert.deepEqual({owner:r.owner,status:r.status,priority:r.priority},v);}
 const state=await readFile(join(dir,'fixture.state.json'),'utf8'),events=await readFile(join(dir,'fixture.events.jsonl'),'utf8');
 await grade();assert.equal(await readFile(join(dir,'fixture.state.json'),'utf8'),state);assert.equal(await readFile(join(dir,'fixture.events.jsonl'),'utf8'),events);
 if(task==='triage'){const [id,v]=Object.entries(e)[0];await call(base+'/record/save',{id,...v as Record<string,string>});}
 else await call(base+`/${task}/save`,e);
 assert.equal((await grade()).passed,false);
 }
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
test('every project goal quotes the exact description without punctuation ambiguity',()=>{
 for(const trial of Object.values(goals.trials) as any[]){const p=trial.tasks.project;assert.ok((p.instructions).includes(`Description (exact text): ${JSON.stringify(p.expectedState.description)}`));assert.equal(p.goalInstructions,p.instructions);}
});
