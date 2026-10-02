import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { APICallError } from 'ai';
import { createDecisionModel, modelConfig, modelDecider, modelProviders } from '../src/tool/model.js';
import { runDesktopGoal } from '../src/tool/task.js';
import type { Snapshot, Candidate, Event } from '../src/shared/contracts.js';

const snapshot: Snapshot = { id: 's', source: 'ax', pid: 42, title: 'Fixture', truncated: false, nodes: [
  { ref: 's:0', role: 'AXButton', name: 'Save', value: '', enabled: true, actions: ['AXPress'], depth: 1 },
] };
const candidates: Candidate[] = [{ id: 'a0', description: 'Save', action: { kind: 'press', ref: 's:0' } }];
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
const response = (reply: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(reply) }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [] });
const action = { choice: 'a0', textIndex: null, evidence: null };

test('configuration preserves Jev default and selects SDK providers explicitly or via environment', () => {
  assert.equal(modelConfig({}, {}), undefined);
  assert.equal(modelConfig({ model: 'org/model' }, {})?.provider, 'gateway');
  assert.deepEqual(modelConfig({ provider: 'openai', model: 'chosen' }, { CU_PROVIDER: 'google', CU_MODEL: 'old' }), {
    provider: 'openai', model: 'chosen', baseURL: undefined, keyEnv: 'OPENAI_API_KEY',
  });
  assert.equal(modelConfig({}, { CU_PROVIDER: 'anthropic', CU_MODEL: 'chosen' })?.keyEnv, 'ANTHROPIC_API_KEY');
  assert.equal(modelConfig({ 'agent-command': '/adapter' }, { CU_MODEL: 'inherited' }), undefined);
  for (const flags of [
    { provider: 'unknown', model: 'x' }, { provider: 'openai' }, { provider: 'compatible', model: 'x' },
    { provider: 'jev', model: 'x' }, { 'agent-command': '/adapter', model: 'x' },
    { model: 'x', 'api-key-env': 'bad-key' }, { model: 'x', 'base-url': 'file:///tmp/model' },
    { model: 'x', 'base-url': 'https://secret@example.com' }, { model: 'x', 'base-url': 'https://example.com?key=secret' },
  ]) assert.throws(() => modelConfig(flags, {}));
});

test('credentials are provider-specific, required before delivery, and optional for compatible local servers', () => {
  for (const provider of ['openai', 'anthropic', 'google', 'gateway'] as const) {
    const config = modelConfig({ provider, model: 'fixture' }, {})!;
    assert.throws(() => createDecisionModel(config, { TYPESAFE_API_KEY: 'not-a-provider-key' }), /Set .*No TypeSafe key/);
  }
  const config = modelConfig({ provider: 'compatible', model: 'local', 'base-url': 'http://127.0.0.1:1234/v1' }, {})!;
  assert.ok(createDecisionModel(config, {}));
});

for (const provider of Object.keys(modelProviders) as (keyof typeof modelProviders)[]) {
  test(`${provider} SDK transport sends the configured model and structured decision, without a Jev key`, async () => {
    let called = 0;
    const fetcher: typeof fetch = async (url, init) => {
      called++;
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      const text = JSON.stringify(action);
      assert.ok(String(url).startsWith('http://127.0.0.1:4444/v1'));
      assert.equal(headers.get('x-api-key') ?? headers.get('x-goog-api-key') ?? headers.get('authorization'), provider === 'anthropic' || provider === 'google' ? 'fixture-key' : 'Bearer fixture-key');
      if (provider === 'gateway') {
        assert.equal(headers.get('ai-language-model-id'), 'fixture-model');
        assert.ok(body.responseFormat.schema);
        return Response.json(response(action));
      }
      if (provider === 'google') {
        assert.match(String(url), /fixture-model:generateContent/);
        assert.ok(body.generationConfig.responseSchema ?? body.generationConfig.responseJsonSchema);
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } });
      }
      assert.equal(body.model, 'fixture-model');
      if (provider === 'openai') {
        assert.match(String(url), /responses$/);
        assert.equal(body.store, false);
        assert.equal(body.text.format.type, 'json_schema');
        return Response.json({ id: 'r1', model: 'fixture-model', status: 'completed', output: [{ type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
      }
      if (provider === 'anthropic') {
        const tool = body.tools?.find((item: { name: string }) => item.name === 'json');
        assert.ok(tool?.input_schema ?? body.output_config?.format?.schema);
        return Response.json({ id: 'm1', type: 'message', role: 'assistant', model: 'fixture-model', stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null,
          content: tool ? [{ type: 'tool_use', id: 't1', name: 'json', input: action }] : [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } });
      }
      assert.equal(body.response_format.type, 'json_schema');
      return Response.json({ id: 'r1', object: 'chat.completion', created: 1, model: 'fixture-model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    };
    const config = modelConfig({ provider, model: 'fixture-model', 'base-url': 'http://127.0.0.1:4444/v1', 'api-key-env': 'FIXTURE_KEY' }, {})!;
    const decide = modelDecider(createDecisionModel(config, { FIXTURE_KEY: 'fixture-key' }, fetcher));
    assert.equal((await decide('Save', snapshot, candidates, [])).target, 'a0');
    assert.equal(called, 1);
  });
}

test('SDK never dispatches unknown targets, invented text indices or ungrounded completion', async () => {
  const fields: Candidate[] = [{ id: 't0', description: 'Name', action: { kind: 'setValue', ref: 's:0' } }];
  for (const reply of [
    { choice: 'stale', textIndex: null, evidence: null },
    { choice: 't0', textIndex: 9, evidence: null },
    { choice: 'done', textIndex: null, evidence: 'Saved' },
  ]) {
    const decide = modelDecider(new MockLanguageModelV4({ doGenerate: response(reply) }));
    await assert.rejects(decide('Save', snapshot, fields, [], undefined, ['Exact']));
  }
});

test('SDK errors redact provider response bodies and respect Stop and request timeout', async () => {
  const failed = modelDecider(new MockLanguageModelV4({ doGenerate: async () => { throw new APICallError({ message: 'secret-key and private screen', url: 'https://private', requestBodyValues: {}, statusCode: 401, responseBody: 'secret-key' }); } }));
  await assert.rejects(failed('Save', snapshot, candidates, []), error => {
    assert.match(String(error), /HTTP 401/); assert.doesNotMatch(String(error), /secret-key|private screen/); return true;
  });
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({ doGenerate: async ({ abortSignal }) => new Promise((_resolve, reject) => {
      abortSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      if (cancel) controller.abort();
    }) });
    await assert.rejects(modelDecider(model, 25)('Save', snapshot, candidates, [], controller.signal), cancel ? /cancelled/ : /timed out/);
  }
});

test('SDK completes a write/save/reopen workflow using fresh observations in a single task', async () => {
  let stage = 0; const events: Event[] = []; const operations: string[] = [];
  const model = new MockLanguageModelV4({ doGenerate: async options => {
    const message = options.prompt.find(item => item.role === 'user');
    assert.ok(message && Array.isArray(message.content) && message.content[0].type === 'text');
    const state = JSON.parse(message.content[0].text);
    assert.match(state.goal, /reopen/);
    if (stage === 3) return response({ choice: 'done', textIndex: null, evidence: 'Reopened: Opcode' });
    const label = stage === 0 ? 'Name' : stage === 1 ? 'Save' : 'Reopen';
    return response({ choice: state.controls.find((item: { description: string }) => item.description.includes(label)).id,
      textIndex: stage === 0 ? state.textValues.indexOf('Opcode') : null, evidence: null });
  } });
  await runDesktopGoal('Set name to "Opcode", save it, reopen it and verify the saved name', '42', async (method, args) => {
    if (method === 'apps') return [{ pid: 42, name: 'Fixture' }];
    if (method === 'snapshot') {
      const id = `stage${stage}`;
      const node = (name: string, role: string, actions: string[], value = '', index = 0) => ({ ref: `${id}:${index}`, name, role, value, enabled: true, focused: true, actions, depth: 1 });
      return { ...snapshot, id, nodes: stage < 2 ? [node('Name', 'AXTextField', ['setValue'], stage === 1 ? 'Opcode' : ''), node('Save', 'AXButton', ['AXPress'], '', 1)]
        : stage === 2 ? [node('Saved: Opcode', 'AXStaticText', []), node('Reopen', 'AXButton', ['AXPress'], '', 1)] : [node('Reopened: Opcode', 'AXStaticText', [])] };
    }
    if (method === 'execute') {
      const action = args?.action as { kind: string; ref: string; text?: string };
      assert.equal(args?.snapshotId, `stage${stage}`);
      assert.ok(action.ref.startsWith(`stage${stage}:`));
      if (stage === 0) assert.equal(action.text, 'Opcode');
      operations.push(action.kind); stage++;
    }
    return {};
  }, modelDecider(model), event => events.push(event), new AbortController().signal);
  assert.deepEqual(operations, ['setValue', 'press', 'press']);
  assert.equal(events.at(-1)?.state, 'succeeded');
  assert.equal(model.doGenerateCalls.length, 4);
});

test('vision-enabled SDK decisions receive the screenshot alongside grounded text', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async options => {
    const user = options.prompt.find(message => message.role === 'user');
    assert.ok(user && user.role === 'user' && user.content.some(part => part.type === 'file' && part.mediaType === 'image/png'));
    return response(action);
  } });
  await modelDecider(model)('Save', snapshot, candidates, [], undefined, [], 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB');
});
