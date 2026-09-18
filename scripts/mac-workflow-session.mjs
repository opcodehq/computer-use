// One real Jev invocation, five native screens, save and independent reopen proof.
// No screenshot calls, intermediate host actions, or replacement instructions.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const temp=await mkdtemp(join(tmpdir(),'jev-workflow-'));
const bundle=join(temp,'JevWorkflowFixture.app');
const bin=join(bundle,'Contents/MacOS/JevWorkflowFixture');
const result=join(temp,'result.json');
const evidence=join(root,'.context/workflow');
await mkdir(join(bundle,'Contents/MacOS'),{recursive:true});await mkdir(evidence,{recursive:true});
await writeFile(join(bundle,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>JevWorkflowFixture</string><key>CFBundleIdentifier</key><string>local.jev.workflowfixture</string><key>CFBundleName</key><string>JevWorkflowFixture</string><key>LSUIElement</key><true/></dict></plist>');
let fixturePID,child;
const name=process.argv[2] ?? 'Orchid QA';
const callback=process.argv[3] ?? 'https://example.test/auth/callback';
const goal=`Create a project named ${JSON.stringify(name)} with callback URL ${JSON.stringify(callback)}. Review and save it, then open the saved project and verify both the name and callback in its saved details. Finish only after the saved project has been reopened.`;
try {
  execFileSync('swiftc',[join(root,'tests/fixtures/macos/WorkflowTarget.swift'),'-o',bin]);
  execFileSync('open',['-g','-n',bundle,'--args',result]);
  for(let i=0;i<40;i++){try{fixturePID=Number(await readFile(result+'.pid','utf8'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!fixturePID)throw Error('Fixture did not launch');
  await new Promise(r=>setTimeout(r,300));
  const started=Date.now();
  child=spawn(process.env.JEV_BUN ?? join(process.env.HOME,'.bun/bin/bun'),[join(root,'dist/cli.mjs'),'task','--app',String(fixturePID),'--instruction',goal],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},120000);
  const hardTimer=setTimeout(()=>child.kill('SIGKILL'),125000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timer);clearTimeout(hardTimer);
  await writeFile(join(evidence,'session.jsonl'),stdout,{mode:0o600});
  const events=stdout.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return {message:l}}});
  let persisted;try{persisted=JSON.parse(await readFile(result,'utf8'));}catch{}
  const summary={invocations:1,hostActionsDuringTask:0,screenshots:0,goal,code,timedOut,durationMs:Date.now()-started,terminal:events.at(-1)?.state,message:events.at(-1)?.message,persisted,actions:events.filter(e=>e.state==='acting').map(e=>e.message),stderr};
  await writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});await appendFile(join(evidence,'runs.jsonl'),JSON.stringify(summary)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
  if(code!==0||summary.terminal!=='succeeded'||persisted?.name!==name||persisted?.callback!==callback||persisted?.saves!==1||persisted?.reopened!==true)process.exitCode=1;
} finally {
  if(child&&child.exitCode===null)child.kill('SIGTERM');
  if(fixturePID)try{process.kill(fixturePID,'SIGTERM')}catch{}
  await rm(temp,{recursive:true,force:true});
}
