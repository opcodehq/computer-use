#!/usr/bin/env python3
"""Run the authenticated local Claude CLI through our desktop MCP only.
Logs stay on this Mac with owner-only permissions. No arbitrary turn limit.
"""
import argparse, json, os, pathlib, shutil, subprocess, datetime
p=argparse.ArgumentParser()
p.add_argument('--app',required=True)
p.add_argument('--agent',choices=['claude','codex'],default='claude')
p.add_argument('--task-file',required=True)
p.add_argument('--output',required=True)
a=p.parse_args()
os.umask(0o077)
root=pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(a.output).resolve(); out.mkdir(parents=True,exist_ok=False)
bun=shutil.which('bun') or str(pathlib.Path.home()/'.bun/bin/bun')
claude=shutil.which('claude') or str(pathlib.Path.home()/'.local/bin/claude')
env=os.environ.copy()
settings=pathlib.Path.home()/'Library/Application Support/jev-desktop/config/settings.json'
if not env.get('TYPESAFE_API_KEY'):
    env['TYPESAFE_API_KEY']=json.loads(settings.read_text()).get('typesafeKey','')
if not env['TYPESAFE_API_KEY']: raise SystemExit('Save a TypeSafe key in the app first.')
env['JEV_ALLOWED_APP']=a.app
env['JEV_INTERACTION_MODE']='background'
env.pop('CLAUDECODE',None)
config=out/'mcp.json'
config.write_text(json.dumps({'mcpServers':{'jev':{'command':bun,'args':[str(root/'dist/cli.mjs'),'mcp']}}}))
task=pathlib.Path(a.task_file).read_text()
(out/'task.md').write_text(task)
cmd=[claude,'-p',task,'--mcp-config',str(config),'--strict-mcp-config','--tools','','--allowedTools','mcp__jev','--permission-mode','dontAsk','--disable-slash-commands','--setting-sources','','--output-format','stream-json','--verbose']
if a.agent == 'codex':
    codex=shutil.which('codex') or str(pathlib.Path.home()/'.nvm/versions/node/v24.18.0/bin/codex')
    cmd=[codex,'exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only',
         '-c','model_reasoning_effort="medium"','-c','approval_policy="never"','-c','features.shell_tool=false',
         '-c','mcp_servers.jev.command='+json.dumps(bun),
         '-c','mcp_servers.jev.args='+json.dumps([str(root/'dist/cli.mjs'),'mcp']),
         '-c','mcp_servers.jev.env_vars='+json.dumps(['TYPESAFE_API_KEY','JEV_ALLOWED_APP','JEV_INTERACTION_MODE']),
         '-c','mcp_servers.jev.required=true',
         *[part for name in ['desktop_status','desktop_apps','desktop_observe','desktop_act','desktop_execute','desktop_click','desktop_type','desktop_key','desktop_windows','desktop_wait'] for part in ['-c','mcp_servers.jev.tools.'+name+'.approval_mode="approve"']], '--json','--output-last-message',str(out/'report.md'),task]
with (out/'events.jsonl').open('w') as log, (out/'stderr.log').open('w') as err:
    child=subprocess.Popen(cmd,cwd=out,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=err,start_new_session=True)
(out/'session.json').write_text(json.dumps({'pid':child.pid,'app':a.app,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'driver':'own-native-AX','agent':a.agent,'log':str(out/'events.jsonl')},indent=2))
print(json.dumps({'pid':child.pid,'output':str(out)}))
