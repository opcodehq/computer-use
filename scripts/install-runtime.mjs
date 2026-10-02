import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if(process.argv.includes('--help')){console.log('cu install\nBuild the native driver in your user cache. Linux: requires cc, X11/XTest headers, Xvfb. Mac: requires Xcode Command Line Tools. Linux downloads a checksum-pinned UI detector; consult docs/LINUX_CLOUD.md for model terms.');process.exit(0);}
if(!['linux','darwin'].includes(process.platform))throw new Error('Native runtime supports Linux and macOS.');
const root=fileURLToPath(new URL('..',import.meta.url));
const command=process.execPath;
const args=process.platform==='linux'?['scripts/setup-linux.mjs']:['scripts/setup-macos.mjs'];
const result=spawnSync(command,args,{cwd:root,env:process.env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
