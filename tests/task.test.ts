import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDesktopGoal, acceptsTaskDecision, acceptsTaskCompletion } from '../src/tool/task.js';
import type { Event } from '../src/shared/contracts.js';
test('open Granola resolves installed app without pressing Finder controls', async () => {
  const calls: string[] = []; const events: Event[] = [];
  await runDesktopGoal('open granola', 'Finder', async (method, args) => {
    calls.push(method);
    if (method === 'installedApps') return [{ id: 'test.granola', name: 'Granola' }];
    assert.equal(args?.appId, 'test.granola'); return { pid: 2, active: true };
  }, async () => { throw Error('Should not classify Finder controls'); }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(calls, ['installedApps', 'launchApp']);
  assert.equal(events.at(-1)?.state, 'succeeded');
});
test('unknown app launch cannot fall through to unrelated buttons', async () => {
  const calls: string[] = []; const events: Event[] = [];
  await runDesktopGoal('open granola', 'Finder', async method => { calls.push(method); return []; }, async () => { throw Error('Unexpected selection'); }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(calls, ['installedApps']); assert.equal(events.at(-1)?.state, 'blocked');
});
test('task observes again after a press and only then considers completion', async () => {
  const calls: string[] = []; const events: Event[] = []; let decisions = 0;
  await runDesktopGoal('Press 7', '42', async method => {
    calls.push(method);
    if (method === 'apps') return [{ pid: 42, name: 'Calculator' }];
    if (method === 'snapshot') return { id: 's', source: 'ax', pid: 42, title: 'Calculator', truncated: false, nodes: [{ ref: 's:0', name: '7', role: 'AXButton', value: '', enabled: true, actions: ['AXPress'], depth: 1 }] };
    return {};
  }, async () => ++decisions === 1 ? { operation: 'press', target: 'a0', confidence: 1, complete: 0 } : { operation: 'done', target: 'none', confidence: 1, complete: 1 }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(calls, ['apps', 'snapshot', 'execute', 'snapshot']); assert.equal(events.at(-1)?.state, 'succeeded');
});

test('task can enter an exact recipient phrase then re-observe', async () => {
  const actions: unknown[] = []; const events: Event[] = []; let decisions = 0;
  await runDesktopGoal('Share daily notes with Legion team', '42', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Notes' }];
    if (method === 'snapshot') return { id: 's', source: 'ax', pid: 42, title: 'Share', truncated: false, nodes: [{ ref: 's:0', name: 'Recipients', role: 'AXTextField', value: '', enabled: true, actions: ['setValue'], depth: 1 }] };
    actions.push(args?.action); return {};
  }, async (_goal, _snapshot, _candidates, _history, _signal, values) => {
    assert.ok(values?.includes('Legion'));
    return ++decisions === 1 ? { operation: 'write', target: 't0', text: 'Legion', confidence: 1, complete: 0 } : { operation: 'blocked', target: 'none', confidence: 1, complete: 0 };
  }, e => events.push(e), new AbortController().signal);
  assert.deepEqual(actions, [{ kind: 'setValue', ref: 's:0', text: 'Legion' }]);
  assert.equal(events.at(-1)?.state, 'blocked');
});
test('task refuses generated text not supplied by the caller', async () => {
  let dispatched = false;
  await runDesktopGoal('Find Legion', '42', async method => {
    if (method === 'apps') return [{ pid: 42, name: 'Notes' }];
    if (method === 'snapshot') return { id: 's', source: 'ax', pid: 42, title: 'Search', truncated: false, nodes: [{ ref: 's:0', name: 'Query', role: 'AXTextField', value: '', enabled: true, actions: ['setValue'], depth: 1 }] };
    dispatched = true; return {};
  }, async () => ({ operation: 'write', target: 't0', text: 'invented@example.com', confidence: 1, complete: 0 }), () => {}, new AbortController().signal);
  assert.equal(dispatched, false);
});

test('uncertain latest-item selection narrows through Search and supplied subject before deciding again', async () => {
  const actions: { kind: string; text?: string }[] = [];
  let decisions = 0;
  const events: Event[] = [];
  await runDesktopGoal('Share the latest daily notes with the team', '42', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Notes' }];
    if (method === 'snapshot') {
      const field = actions.length > 0;
      return { id: `s${actions.length}`, source: 'ax', pid: 42, title: 'Notes', truncated: false, nodes: [{ ref: 'target', depth: 0, role: field ? 'AXTextField' : 'AXButton', name: field ? 'Search notes' : 'Search', value: actions.length > 1 ? 'daily' : '', enabled: true, actions: field ? ['setValue'] : ['AXPress'] }] };
    }
    if (method === 'execute') actions.push(args?.action as { kind: string; text?: string });
    return {};
  }, async () => ++decisions === 1 ? { operation: 'press', target: 'none', confidence: 0.2, complete: 0 } : { operation: 'blocked', target: 'none', confidence: 1, complete: 0 }, e => events.push(e), new AbortController().signal);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]!.kind, 'press');
  assert.equal(actions[1]!.kind, 'setValue');
  assert.equal(actions[1]!.text, 'daily');
  assert.equal(decisions, 2);
  assert.equal(events.at(-1)?.state, 'blocked');
});

test('task focuses an unfocused web field and uses a fresh ref for its write', async () => {
  const actions: unknown[] = []; let count = 0;
  await runDesktopGoal('Set Description to "Zuse"', 'Safari', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Safari' }];
    if (method === 'snapshot') return { id: `s${count}`, source: 'ax', pid: 42, title: 'Form', truncated: false, nodes: [{ ref: `s${count}:0`, role: 'AXTextField', name: 'Description', value: count === 2 ? 'Zuse' : '', focused: count > 0, enabled: true, depth: 1, actions: ['AXPress','setValue'] }] };
    actions.push(args?.action); count++; return {};
  }, async () => count === 2 ? { operation: 'done', target: 'none', confidence: 1, complete: 1 } : { operation: 'write', target: 't0', text: 'Zuse', confidence: 1, complete: 0 }, () => {}, new AbortController().signal);
  assert.deepEqual(actions, [{ kind: 'press', ref: 's0:0' }, { kind: 'setValue', ref: 's1:0', text: 'Zuse' }]);
});

test('task focuses Safari address field without AXPress and uses a fresh ref for its write', async () => {
  const actions: unknown[] = []; let count = 0;
  await runDesktopGoal('Navigate to "https://developer.apple.com"', 'Safari', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Safari' }];
    if (method === 'snapshot') return { id: `s${count}`, source: 'ax', pid: 42, title: 'Form', truncated: false, nodes: [{ ref: `s${count}:0`, role: 'AXTextField', name: 'smart search field', value: count === 2 ? 'https://developer.apple.com' : '', focused: count > 0, enabled: true, depth: 1, actions: ['focus','setValue'] }] };
    actions.push(args?.action); count++; return {};
  }, async () => count === 2 ? { operation: 'done', target: 'none', confidence: 1, complete: 1 } : { operation: 'write', target: 't0', text: 'https://developer.apple.com', confidence: 1, complete: 0 }, () => {}, new AbortController().signal);
  assert.deepEqual(actions, [{ kind: 'focus', ref: 's0:0' }, { kind: 'setValue', ref: 's1:0', text: 'https://developer.apple.com' }]);
});

test('task waits through server processing without repeating a submission', async () => {
  let observations = 0, decisions = 0, actions = 0;
  await runDesktopGoal('Register item', 'Safari', async method => {
    if (method === 'apps') return [{ pid: 42, name: 'Safari' }];
    if (method === 'snapshot') {
      observations++;
      return { id: `s${observations}`, source: 'ax', pid: 42, title: 'Form', truncated: false, nodes: [{ ref: `s${observations}:0`, role: 'AXButton', name: observations === 2 ? 'Processing' : 'Register', value: '', enabled: observations !== 2, depth: 1, actions: ['AXPress'] }] };
    }
    actions++; return {};
  }, async () => ++decisions === 1 ? { operation: 'press', target: 'a0', confidence: 1, complete: 0 } : { operation: 'done', target: 'none', confidence: 1, complete: 1 }, () => {}, new AbortController().signal);
  assert.equal(observations, 3); assert.equal(actions, 1); assert.equal(decisions, 2);
});

test('separate navigation evidence never authorizes uncertain submissions or writes', () => {
  const base = { operation: 'press', target: 'x', confidence: 0.4, complete: 0, navigationSupport: 0.99 };
  for (const action of [{ kind: 'press' as const, ref: 's:0' }, { kind: 'backgroundKey' as const, ref: 's:0', text: 'Enter' }, { kind: 'setValue' as const, ref: 's:0', text: 'new' }]) {
    assert.equal(acceptsTaskDecision(base, [{ id: 'x', description: 'Save', action }]), false);
  }
  const options = [{ id: 'x', description: 'Focus dialog', action: { kind: 'focus' as const, ref: 's:0' } }];
  assert.equal(acceptsTaskDecision(base, options), true);
  assert.equal(acceptsTaskDecision({ ...base, navigationSupport: 0.59 }, options), false);
  assert.equal(acceptsTaskDecision({ ...base, confidence: NaN }, options), false);
  assert.equal(acceptsTaskDecision({ ...base, target: 'invented' }, options), false);
});


test('completion requires both operation agreement and fresh outcome evidence', () => {
  const decision = { operation:'done',target:'none',confidence:.95,complete:.91 };
  assert.equal(acceptsTaskCompletion(decision),true);
  for (const change of [{confidence:.89},{complete:.89},{complete:NaN},{complete:1.1},{confidence:Infinity},{operation:'press'}]) {
    assert.equal(acceptsTaskCompletion({...decision,...change}),false);
  }
});

test('one workflow excludes an ineffective action, takes another route, and completes', async () => {
  let stage = 0, attempts = 0; const events: Event[] = []; const goals: string[] = [];
  await runDesktopGoal('Create the project and verify it is saved', '42', async (method,args) => {
    if (method==='apps') return [{pid:42,name:'Fixture'}];
    if (method==='snapshot') return {id:`s${attempts}`,source:'ax',pid:42,title:'Fixture',truncated:false,nodes:stage===0 ? [
      {ref:`s${attempts}:0`,role:'AXButton',name:'Open project',value:'',enabled:true,actions:['AXPress'],depth:1},
      {ref:`s${attempts}:1`,role:'AXButton',name:'Alternate route',value:'',enabled:true,actions:['AXPress'],depth:1},
    ] : [{ref:'done',role:'AXStaticText',name:'Project saved',value:'',enabled:true,actions:[],depth:1}]};
    if(method==='execute'){ attempts++; if((args?.action as {ref:string}).ref.endsWith(':1'))stage=1; return {}; }
    throw Error('Unexpected request');
  },async(goal,_snapshot,candidates,history)=>{
    goals.push(goal);
    if(stage===1)return {operation:'done',target:'none',confidence:1,complete:1};
    if(attempts===0)return {operation:'press',target:'a0',confidence:1,complete:0};
    assert.ok(!candidates.some(c=>c.id==='a0'));
    assert.ok(history.some(h=>h.startsWith('INEFFECTIVE:')));
    return {operation:'press',target:'a1',confidence:1,complete:0};
  },e=>events.push(e),new AbortController().signal);
  assert.equal(attempts,2); assert.equal(new Set(goals).size,1);
  assert.equal(events.at(-1)?.state,'succeeded'); assert.ok(events.some(e=>e.state==='recovering'));
});

test('foreground refusal waits and resumes the same workflow with a new reference', async () => {
  let observations=0, attempts=0; const refs:string[]=[]; const events:Event[]=[];
  await runDesktopGoal('Save the project', '42', async (method,args)=>{
    if(method==='apps')return [{pid:42,name:'Fixture'}];
    if(method==='inputState')return {foregroundPID:77};
    if(method==='snapshot')return {id:`s${++observations}`,source:'ax',pid:42,title:'Fixture',truncated:false,nodes:[{ref:`s${observations}:0`,role:'AXButton',name:'Save',value:'',enabled:true,actions:['AXPress'],depth:1}]};
    if(method==='execute'){
      refs.push((args?.action as {ref:string}).ref);
      if(++attempts===1)throw Object.assign(Error('User active'),{code:'UserActiveInTarget',delivery:'notDispatched'});
      return {};
    }
    throw Error('Unexpected request');
  },async()=> attempts<2 ? {operation:'press',target:'a0',confidence:1,complete:0}:{operation:'done',target:'none',confidence:1,complete:1},e=>events.push(e),new AbortController().signal);
  assert.deepEqual(refs,['s1:0','s2:0']);assert.equal(events.at(-1)?.state,'succeeded');assert.ok(events.some(e=>e.state==='waiting'));
});

test('split action confidence requires strong independent evidence on an existing target', () => {
  const candidates=[{id:'next',description:'Next',action:{kind:'press' as const,ref:'s:0'}}];
  const decision={operation:'press',target:'next',confidence:.42,complete:0,actionSupport:.94};
  assert.equal(acceptsTaskDecision(decision,candidates),true);
  for(const support of [.89,NaN,Infinity,1.1])assert.equal(acceptsTaskDecision({...decision,actionSupport:support},candidates),false);
  assert.equal(acceptsTaskDecision({...decision,target:'invented'},candidates),false);
  assert.equal(acceptsTaskDecision({...decision,operation:'done'},candidates),false);
});

test('exact field recovery and navigation have distinct evidence requirements', () => {
  const write=[{id:'field',description:'Callback URL',action:{kind:'setValue' as const,ref:'s:0'}}];
  assert.equal(acceptsTaskDecision({operation:'write',target:'field',confidence:.47,complete:0,actionSupport:.81},write),true);
  assert.equal(acceptsTaskDecision({operation:'write',target:'field',confidence:.47,complete:0,actionSupport:.79},write),false);
  const next=[{id:'next',description:'AXButton: Next; current value=',action:{kind:'press' as const,ref:'s:1'}}];
  assert.equal(acceptsTaskDecision({operation:'press',target:'next',confidence:.4,complete:0,navigationSupport:.65},next),true);
  assert.equal(acceptsTaskDecision({operation:'press',target:'next',confidence:.4,complete:0,navigationSupport:.59},next),false);
});

test('Stop cancels a workflow waiting for foreground use without dispatching again', async () => {
  const controller=new AbortController();let attempts=0;
  await assert.rejects(()=>runDesktopGoal('Save project','42',async(method)=>{
    if(method==='apps')return [{pid:42,name:'Fixture'}];
    if(method==='snapshot')return {id:'s',source:'ax',pid:42,title:'Fixture',truncated:false,nodes:[{ref:'s:0',role:'AXButton',name:'Save',value:'',enabled:true,actions:['AXPress'],depth:1}]};
    if(method==='execute'){attempts++;throw Object.assign(Error('In use'),{code:'UserActiveInTarget',delivery:'notDispatched'});}
    throw Error('Should not poll after Stop');
  },async()=>({operation:'press',target:'a0',confidence:1,complete:0}),e=>{if(e.state==='waiting')controller.abort();},controller.signal));
  assert.equal(attempts,1);
});

test('completion can use a focused final-screen audit but never input-action support', () => {
  const d={operation:'done',target:'none',confidence:.88,complete:.86};
  assert.equal(acceptsTaskCompletion(d),false);
  assert.equal(acceptsTaskCompletion({...d,completionEvidence:.95}),true);
  assert.equal(acceptsTaskCompletion({...d,actionSupport:1}),false);
  for(const evidence of [.89,NaN,Infinity,1.1])assert.equal(acceptsTaskCompletion({...d,completionEvidence:evidence}),false);
  assert.equal(acceptsTaskCompletion({...d,confidence:.5,completionEvidence:1}),false);
});
