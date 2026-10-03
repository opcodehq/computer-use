#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const {version}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const native=process.env.CU_NATIVE_DIR??join(process.env.XDG_CACHE_HOME??join(homedir(),'.cache'),'opcodehq','cu',version,process.platform+'-'+process.arch);
const args=process.argv.slice(2);
const command=args[0];
const entry=command==='desktop-api'?join(root,'dist/desktop-api.mjs'):command==='helper-restart'?join(root,'dist/helper-proxy.mjs'):command==='install'?join(root,'scripts/install-runtime.mjs'):command==='desktop'?join(root,'scripts/desktop-linux.mjs'):join(root,'dist/cli.mjs');
const env={...process.env,CU_PACKAGE_LAUNCHER:join(root,'bin/cu.mjs'),CU_NATIVE_DIR:native,CU_X11_HELPER:process.env.CU_X11_HELPER??join(native,'cu-x11'),CU_YOLO_MODEL_PATH:process.env.CU_YOLO_MODEL_PATH??join(native,'ui-detector.onnx')};
const runtime=command==='install'&&!args.includes('--minimal') ? (process.env.CU_BUN_PATH??'bun') : process.execPath;
const child=spawn(runtime,[entry,...(command==='helper-restart'?['--shutdown']:command==='install'||command==='desktop'||command==='desktop-api'?args.slice(1):args)],{stdio:'inherit',env});
child.once('error',error=>{console.error(error.code==='ENOENT'?'CU requires Bun 1.3.10 or newer. Install Bun, then rerun cu. Native setup: cu install.':error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?130:1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
