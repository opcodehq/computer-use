import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTaskPreview, previewPacket } from '../src/tool/preview.js';

test('preview strips refs and values, retains keyboard targets and clears completion markers', () => {
  const node = { ref:'private-ref',role:'AXTextField',name:'Name',value:'sensitive-value',actions:['setValue'],depth:1,enabled:true,frame:{x:2,y:3,width:60,height:20} };
  const event = { state:'acting',message:'Writing',snapshot:{id:'snapshot',source:'ax' as const,pid:7,title:'Test',nodes:[node],truncated:false},candidate:{id:'choice',description:'write',action:{kind:'setValue' as const,ref:node.ref,text:'private-text'}} };
  const packet=previewPacket(event);
  assert.deepEqual(packet.target,node.frame);
  assert.deepEqual(previewPacket({state:'acting',message:'Click',candidate:event.candidate},event.snapshot).target,node.frame);
  for (const privateValue of ['private-ref','private-text','sensitive-value']) assert.ok(!JSON.stringify(packet).includes(privateValue));
  assert.equal(previewPacket({...event,state:'succeeded'}).target,null);
});

test('missing preview does not block the task', async () => {
  const warnings: string[]=[];
  assert.equal(await openTaskPreview('/does-not-exist',()=>assert.fail('stop'),m=>warnings.push(m)),undefined);
  assert.match(warnings[0]!,/missing/);
});

test('preview routes Stop once and exits cleanly when its window closes early', async () => {
  const dir=await mkdtemp(join(tmpdir(),'cu-preview-test-'));
  try {
    const path=join(dir,'preview');
    await writeFile(path,'#!/bin/sh\nread line\nprintf \'{"stop":true}\\n\'\n');await chmod(path,0o755);
    let stops=0;
    const preview=await openTaskPreview(path,()=>stops++,()=>{});
    preview!.send({state:'starting',message:'Start'});
    await new Promise(r=>setTimeout(r,80));
    preview!.send({state:'acting',message:'Window already closed'});
    await preview!.close();assert.equal(stops,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a resumed persistent preview accepts another Stop request', async () => {
  const dir=await mkdtemp(join(tmpdir(),'cu-preview-resume-'));
  try {
    const path=join(dir,'preview');
    await writeFile(path,'#!/bin/sh\nwhile read line; do printf \'{"stop":true}\\n\'; done\n');await chmod(path,0o755);
    let stops=0;
    const preview=await openTaskPreview(path,()=>stops++,()=>{});
    preview!.send({state:'starting',message:'Start'});
    for(let i=0;i<50&&stops<1;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(stops,1);
    preview!.send({state:'resumed',message:'Resumed'});
    for(let i=0;i<50&&stops<2;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(stops,2);
    await preview!.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});
