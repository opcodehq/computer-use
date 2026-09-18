import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePreview } from '../src/vision/preview.js';
const snapshot = { id: 'fresh', source: 'ax' as const, pid: 1, title: 'App', truncated: false, nodes: [] };
test('plain preview captures without running detection or adding click targets', async () => {
  const event = await capturePreview(snapshot, async (method,args) => {
    assert.equal(method,'screenshot'); assert.deepEqual(args,{snapshotId:'fresh'});
    return {base64:'image',width:800,height:600,origin:{x:20,y:30}};
  });
  assert.equal(event.image,'image'); assert.deepEqual(event.imageFrame,{x:20,y:30,width:800,height:600});
  assert.equal(event.snapshot,snapshot); assert.equal('visual' in event.snapshot,false);
});
test('capture failures and invalid geometry cannot produce an updated preview', async () => {
  await assert.rejects(capturePreview(snapshot,async()=>{throw Error('Permission denied')}),/Permission denied/);
  await assert.rejects(capturePreview(snapshot,async()=>({base64:'x',width:0,height:4,origin:{x:0,y:0}})),/geometry/);
});
