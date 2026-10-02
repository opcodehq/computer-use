import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('any shell agent can observe and act with exact CLI flags, pause/resume, and no model setup', { timeout: 30000 }, async () => {
  const dir=await mkdtemp(join(tmpdir(),'cu-driver-cli-'));
  const driver=join(dir,'driver');
  await writeFile(driver, `#!${process.execPath}
import {createInterface} from 'node:readline';
let count=0;
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);let data={};
 if(r.method==='apps')data=[{pid:42,name:'Fixture'}];
 if(r.method==='execute'){if(r.snapshotId!=='s'+count||r.action.ref!=='s'+count+':0')process.exit(2);count++;}
 if(r.method==='snapshot')data={id:'s'+count,source:'ax',pid:42,title:'Fixture',truncated:false,nodes:[{ref:'s'+count+':0',name:count?'Saved':'Save',role:'AXButton',value:'',actions:['AXPress'],depth:1,enabled:true}]};
 console.log(JSON.stringify({id:r.id,ok:true,data}));
});`,{mode:0o700});
  const session='driver-'+process.pid+'-'+Date.now();
  const env={...process.env,JEV_DRIVER_PATH:driver,JEV_SETTINGS_PATH:join(dir,'missing'),TYPESAFE_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',CU_PROVIDER:'invalid-must-not-be-read',CU_MODEL:'invalid'};
  const binary=process.env.CU_TEST_CLI;
  const call=(...args:string[])=>JSON.parse(execFileSync(binary??process.execPath,[...(binary?[]:[resolve('src/tool/cli.ts')]),...args,'--session',session],{env,encoding:'utf8',stdio:'pipe',timeout:10000}));
  try {
    const before=call('observe','--app','42','--no-preview');
    assert.equal(before.id,'s0');
    const after=call('execute','--app','42','--snapshot-id',before.id,'--ref',before.nodes[0].ref,'--operation','press');
    assert.equal(after.dispatched,true);assert.equal(after.snapshot.nodes[0].name,'Saved');
    assert.equal(call('pause').status,'paused');
    assert.throws(()=>call('execute','--app','42','--snapshot-id','s1','--ref','s1:0','--operation','press'),/paused/);
    assert.equal(call('observe','--app','42').id,'s1');
    assert.equal(call('resume').status,'ready');
    assert.throws(()=>call('execute','--app','42','--snapshot-id','s1','--ref','s1:0','--operation','press'),/Observe fresh/);
    call('observe','--app','42');
    assert.equal(call('execute','--app','42','--snapshot-id','s1','--ref','s1:0','--operation','press').snapshot.id,'s2');
  } finally {
    try{call('stop');}finally{await rm(dir,{recursive:true,force:true});}
  }
});
