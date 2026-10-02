import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// A real local HTTP model server and native-protocol subprocess exercise the shipped CLI path.
test('CLI SDK workflow runs without TypeSafe, adapters, or saved settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cu-sdk-cli-'));
  let requests = 0;
  const server = createServer(async (req, res) => {
    try {
      let input = ''; for await (const chunk of req) input += chunk;
      const body = JSON.parse(input);
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, undefined);
      assert.equal(body.model, 'local-fixture');
      const state = JSON.parse(body.messages.find((message: {role: string}) => message.role === 'user').content);
      const texts = state.observedText.map((item: {text: string}) => item.text);
      const done = texts.includes('Reopened: Opcode');
      const label = texts.includes('Saved: Opcode') ? 'Reopen' : texts.includes('Name Opcode') ? 'Save' : 'Name';
      const choice = done ? 'done' : state.controls.find((item: {description: string}) => item.description.includes(label)).id;
      requests++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'r' + requests, object: 'chat.completion', created: 1, model: 'local-fixture', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ choice, textIndex: !done && label === 'Name' ? state.textValues.indexOf('Opcode') : null, evidence: done ? 'Reopened: Opcode' : null }) } }] }));
    } catch { res.statusCode = 500; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const driver = join(directory, 'driver');
    await writeFile(driver, `#!${process.execPath}
import { createInterface } from 'node:readline';
let stage=0;
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line); let data={};
 if(r.method==='apps') data=[{pid:42,name:'Fixture'}];
 if(r.method==='snapshot') {
  const id='s'+stage;
  const node=(name,role,actions,value='',index=0)=>({ref:id+':'+index,name,role,actions,value,enabled:true,focused:true,depth:1});
  data={id,source:'ax',pid:42,title:'Fixture',truncated:false,nodes:stage<2?[node('Name','AXTextField',['setValue'],stage===1?'Opcode':''),node('Save','AXButton',['AXPress'],'',1)]:stage===2?[node('Saved: Opcode','AXStaticText',[]),node('Reopen','AXButton',['AXPress'],'',1)]:[node('Reopened: Opcode','AXStaticText',[])]};
 }
 if(r.method==='execute') {
  if(r.snapshotId!=='s'+stage || !r.action.ref.startsWith('s'+stage+':') || (stage===0 && r.action.text!=='Opcode')) process.exit(2);
  stage++;
 }
 console.log(JSON.stringify({id:r.id,ok:true,data}));
});`, { mode: 0o700 });
    const env = { ...process.env, JEV_DRIVER_PATH: driver, JEV_SETTINGS_PATH: join(directory, 'nonexistent'), TYPESAFE_API_KEY: '', CU_API_KEY: '', CU_MODEL: '', CU_PROVIDER: '', CU_BASE_URL: '', CU_API_KEY_ENV: '' };
    // Remove model defaults so this tests solely explicit CLI flags.
    for (const name of ['CU_MODEL', 'CU_PROVIDER', 'CU_BASE_URL', 'CU_API_KEY_ENV'] as const) delete (env as NodeJS.ProcessEnv)[name];
    const binary = process.env.CU_TEST_CLI;
    const args = [...(binary ? [] : [resolve('src/tool/cli.ts')]), 'task', '--app', '42', '--instruction', 'Set name to "Opcode", save it, reopen it and verify the saved name', '--provider', 'compatible', '--model', 'local-fixture', '--base-url', `http://127.0.0.1:${address.port}/v1`, '--no-preview'];
    const child = spawn(binary ?? process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
      assert.equal(code, 0, stderr + stdout);
      const events = stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events.at(-1).state, 'succeeded');
      assert.equal(events.filter(event => event.state === 'acting').length, 3);
      assert.equal(requests, 4);
    } finally { clearTimeout(timer); child.kill(); }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
