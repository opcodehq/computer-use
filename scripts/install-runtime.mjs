import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if(process.argv.includes('--help')){console.log('cu install\nBuild the native driver in your user cache. Linux: requires cc and X11/XTest headers. --minimal supports the Node-only raw service; Xvfb is only needed to create a desktop. Mac: requires Xcode Command Line Tools. Linux defaults to raw capture; --with-model downloads a checksum-pinned UI detector; consult docs/LINUX_CLOUD.md for model terms.');process.exit(0);}
if(process.argv.includes('--minimal')&&process.platform!=='linux')throw new Error('--minimal currently supports the Linux desktop service only.');
if(!['linux','darwin'].includes(process.platform))throw new Error('Native runtime supports Linux and macOS.');
const root=fileURLToPath(new URL('..',import.meta.url));
const command=process.execPath;
const args=process.platform==='linux'?['scripts/setup-linux.mjs',...process.argv.slice(2)]:['scripts/setup-macos.mjs'];
const result=spawnSync(command,args,{cwd:root,env:process.env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
