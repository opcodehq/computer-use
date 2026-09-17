#!/usr/bin/env python3
"""Summarize local tool traces without copying full application observations."""
import argparse, collections, json, pathlib
p=argparse.ArgumentParser(); p.add_argument('session'); a=p.parse_args()
root=pathlib.Path(a.session)
counts=collections.Counter(); statuses=collections.Counter(); actions=[]; messages=[]
for line in (root/'events.jsonl').read_text().splitlines():
    try: event=json.loads(line)
    except json.JSONDecodeError: continue
    item=event.get('item',{})
    if event.get('type')=='item.completed' and item.get('type')=='agent_message': messages.append(item.get('text',''))
    if event.get('type')!='item.completed' or item.get('type')!='mcp_tool_call': continue
    tool=item.get('tool'); counts[tool]+=1
    result=item.get('result') or {}
    row={'tool':tool,'transportStatus':item.get('status')}
    if item.get('error'): row['error']=item['error']
    for content in result.get('content',[]):
        if content.get('type')!='text': continue
        try: data=json.loads(content['text'])
        except (json.JSONDecodeError,TypeError):
            row['error']=content['text'][:500]; continue
        if not isinstance(data,dict): continue
        row['status']=data.get('status','observed')
        statuses[row['status']]+=1
        if data.get('selected'): row['selected']=data['selected']['description'].split('; ref=')[0]
        if data.get('selection'): row['confidence']=data['selection'].get('confidence')
        snapshot=data.get('snapshot') or (data if 'nodes' in data else {})
        if snapshot:
            row['nodes']=len(snapshot.get('nodes',[])); row['partial']=snapshot.get('truncated')
            row['headings']=[n['name'] or n['value'] for n in snapshot.get('nodes',[]) if n.get('role')=='AXHeading']
    actions.append(row)
summary={'calls':dict(counts),'statuses':dict(statuses),'actions':actions,'agentMessages':messages}
(root/'summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({'calls':dict(counts),'statuses':dict(statuses),'lastActions':actions[-6:],'latestMessage':messages[-1] if messages else None},indent=2))
