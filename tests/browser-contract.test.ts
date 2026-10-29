import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { BrowserTools } from '../src/browser/tools.js';
const chrome = process.env.TEST_CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const integration = existsSync(chrome) ? test : test.skip;
async function fixture(body: string, run: (tools: BrowserTools, pageId: string, snapshot: any) => Promise<void>) {
  const server = createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end(req.url === '/done' ? '<h1>Saved once</h1>' : body); });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const tools = new BrowserTools({headless:true, executablePath:chrome});
  try {
    const opened = await tools.call({operation:'open'}) as any;
    const pageId = opened.tabs[0].id;
    const address = server.address() as {port:number};
    await tools.call({operation:'navigate',pageId,url:`http://127.0.0.1:${address.port}`});
    await run(tools,pageId,await tools.call({operation:'observe',pageId}));
  } finally { await tools.close(); await new Promise<void>(r => server.close(() => r())); }
}
integration('browser names associated labels and returns select values and options', { timeout: 30000 }, async () => {
  await fixture('<label>Customer<input></label><label for="owner">Owner</label><input id="owner"><span id="p">Priority</span><select aria-labelledby="p"><option value="low">Low</option><option selected value="high">High</option></select><input type="submit" value="Save">', async (_tools,_page,s) => {
    assert.ok(s.nodes.some((n:any) => n.name === 'Customer'));
    assert.ok(s.nodes.some((n:any) => n.name === 'Owner'));
    const select = s.nodes.find((n:any) => n.name === 'Priority');
    assert.equal(select.value,'high');
    assert.deepEqual(select.options.map((o:any) => o.label),['Low','High']);
    assert.ok(s.nodes.some((n:any) => n.name === 'Save'));
  });
});
integration('batch fills exact refs once and returns reusable fresh observation', { timeout: 30000 }, async () => {
  await fixture('<label>Customer<input></label><label>Owner<input></label><label>Priority<select><option value="low">Low</option><option value="high">High</option></select></label>', async (tools,pageId,s) => {
    const fields=s.nodes.filter((n:any) => ['input','select'].includes(n.role));
    const result = await tools.call({operation:'fillForm',pageId,snapshotId:s.snapshotId,fields:[{ref:fields[0].ref,text:'Harbor'},{ref:fields[1].ref,text:'Maya'},{ref:fields[2].ref,value:'high'}]}) as any;
    assert.notEqual(result.snapshotId,s.snapshotId);
    assert.deepEqual(result.nodes.filter((n:any) => ['input','select'].includes(n.role)).map((n:any) => n.value),['Harbor','Maya','high']);
    await assert.rejects(tools.call({operation:'fill',pageId,snapshotId:s.snapshotId,ref:fields[0].ref,text:'stale'}),/Stale/);
    const fresh=result.nodes.find((n:any) => n.name==='Owner');
    const next=await tools.call({operation:'fill',pageId,snapshotId:result.snapshotId,ref:fresh.ref,text:'Luis'}) as any;
    assert.equal(next.nodes.find((n:any) => n.name==='Owner').value,'Luis');
  });
});
integration('invalid batch validates all fields before writing and never replays after navigation', { timeout: 30000 }, async () => {
  await fixture('<label>Customer<input oninput="location.href=\'/done\'"></label><label>Owner<input></label>', async (tools,pageId,s) => {
    const fields=s.nodes.filter((n:any) => n.role==='input');
    await assert.rejects(tools.call({operation:'fillForm',pageId,snapshotId:s.snapshotId,fields:[{ref:fields[0].ref,text:'Harbor'},{ref:'invalid',text:'Maya'}]}),/Stale/);
    const result=await tools.call({operation:'fillForm',pageId,snapshotId:s.snapshotId,fields:[{ref:fields[0].ref,text:'Harbor'},{ref:fields[1].ref,text:'Maya'}]}) as any;
    assert.equal(result.status,'partiallyDispatched');
    assert.equal(result.completedFields,1);
  });
});
integration('navigation after click returns fresh result instead of an observation race failure', { timeout: 30000 }, async () => {
  await fixture('<button onclick="location.href=\'/done\'">Save</button>', async (tools,pageId,s) => {
    const result=await tools.call({operation:'click',pageId,snapshotId:s.snapshotId,ref:s.nodes[0].ref}) as any;
    assert.equal(result.status,'dispatchedUnverified');
    assert.ok(result.nodes.some((n:any) => n.name==='Saved once'));
  });
});
integration('post-dispatch observation failure preserves dispatch result and never repeats a click', { timeout: 30000 }, async () => {
  await fixture('<button onclick="document.querySelector(\'p\').textContent=String(Number(document.querySelector(\'p\').textContent)+1)">Save</button><p>0</p>', async (tools,pageId,s) => {
    const original = (tools as any).snapshot.bind(tools);
    (tools as any).snapshot = async () => { throw new Error('Observation unavailable'); };
    const result = await tools.call({operation:'click',pageId,snapshotId:s.snapshotId,ref:s.nodes[0].ref}) as any;
    assert.equal(result.status,'dispatchedUnverified');
    assert.match(result.observationError,/Observation unavailable/);
    (tools as any).snapshot = original;
    const observed = await tools.call({operation:'observe',pageId}) as any;
    assert.equal(observed.nodes.find((n:any) => n.role === 'p').value,'1');
  });
});
integration('batch option validation rejects the whole batch before any field changes', { timeout: 30000 }, async () => {
  await fixture('<label>Customer<input></label><label>Priority<select><option value="high">High</option></select></label>', async (tools,pageId,s) => {
    const fields=s.nodes.filter((n:any) => ['input','select'].includes(n.role));
    await assert.rejects(tools.call({operation:'fillForm',pageId,snapshotId:s.snapshotId,fields:[{ref:fields[0].ref,text:'Harbor'},{ref:fields[1].ref,value:'missing'}]}),/unavailable/);
    const observed = await tools.call({operation:'observe',pageId}) as any;
    assert.equal(observed.nodes.find((n:any) => n.name === 'Customer').value,'');
  });
});
integration('fresh post-action state preserves dialog ownership and blocks unrelated operations', { timeout: 30000 }, async () => {
  await fixture('<button onclick="alert(\'Confirm\')">Save</button>', async (tools,pageId,s) => {
    const result=await tools.call({operation:'click',pageId,snapshotId:s.snapshotId,ref:s.nodes[0].ref}) as any;
    assert.equal(result.status,'dialogPending');
    await assert.rejects(tools.call({operation:'observe',pageId}),/pending dialog/);
    await assert.rejects(tools.call({operation:'dialog',pageId:'unknown',dialogId:result.dialogs[0].id,accept:true}),/Unknown or closed/);
    await tools.call({operation:'dialog',pageId,dialogId:result.dialogs[0].id,accept:true});
    assert.ok((await tools.call({operation:'observe',pageId}) as any).snapshotId);
  });
});
integration('cancellation during post-action observation rejects instead of returning successful dispatch', { timeout: 30000 }, async () => {
  await fixture('<button>Save</button>', async (tools,pageId,s) => {
    const controller=new AbortController();
    (tools as any).snapshot = async () => { controller.abort(); throw new Error('Observation cancelled'); };
    await assert.rejects(tools.call({operation:'click',pageId,snapshotId:s.snapshotId,ref:s.nodes[0].ref},controller.signal),/abort/i);
  });
});
