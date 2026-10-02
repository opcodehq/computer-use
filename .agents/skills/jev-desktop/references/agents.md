# Use CU with your agent

CU is a driver for your existing authenticated agent. The agent keeps ownership
of the model, subscription or API account, planning and complete workflow. CU does
not read or copy the agent's login tokens. Native tools need no model credentials.
Choose the integration that fits where your agent already runs. Native control requires a Mac; Linux supports
building and testing the protocol, not controlling native Mac apps.

## An existing coding-agent conversation

Any agent with shell access to the controlled machine can call `cu`. Any client with
MCP stdio support can connect to `cu mcp`. Export the server configuration:

```sh
cu config generic
```

Copy the returned `mcpServers` entry into your client's MCP configuration. The
exact configuration file depends on that client. `cu connect codex` and
`cu connect claude` remain convenience installers for those clients.

Give the agent `cu instructions`. It should observe, select a fresh control,
execute it, and inspect the returned state until the goal is verified:

```sh
cu observe --session my-task --app Safari
cu execute --session my-task --app Safari --snapshot-id ID_FROM_OBSERVATION --ref REF_FROM_OBSERVATION --operation press
cu stop --session my-task
```

Replace the example IDs with actual returned IDs. Keep one session so refs remain
valid. MCP clients use `desktop_observe` and `desktop_execute` in one connection.
These exact tools need **no TypeSafe, Claude, or OpenAI key in CU**. The host
agent uses its existing model and login. `act` / `desktop_act` optionally delegates
a semantic choice to Jev and does require a TypeSafe key.

Install the skill in another agent’s chosen directory with
`cu skill generic --dir PATH`, or give it `cu instructions`.

`cu doctor` reports native-tool readiness in `ready`, and native readiness plus
presence of a TypeSafe key in `jevReady`. Neither checks model-key validity.

## Built-in decision models through Vercel AI SDK

This is optional direct API delegation, separate from your existing agent’s
subscription-backed driver workflow. No adapter is needed for these providers. Choose your provider and an exact
model ID available to your account:

```sh
cu providers
cu task --provider anthropic --model "$MODEL_ID" --app Safari \
  --instruction 'Complete the authorized workflow and verify its final result'
```

Set the selected provider's API key in the environment before running the command.
CU does not reuse a coding-agent subscription login for direct API requests.

| `--provider` | Key environment variable | Model ID |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | OpenAI Responses model ID |
| `anthropic` | `ANTHROPIC_API_KEY` | Anthropic model ID |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | Google Generative AI model ID |
| `gateway` | `AI_GATEWAY_API_KEY` | Gateway `provider/model` ID |
| `compatible` | `CU_API_KEY` (optional for local servers) | Endpoint's model ID |
| `jev` | `TYPESAFE_API_KEY` or saved app key | No `--model`; existing typed decisions |

`--model` alone chooses Gateway unless `CU_PROVIDER` is set. Gateway offers a
shared route to its available providers; direct providers use their own APIs.
The SDK does not make every model support structured decisions. Use a model and
endpoint that support structured JSON output. See the
[AI SDK structured-output guide](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
and [Gateway documentation](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway).

For a local or remote OpenAI-compatible chat-completions endpoint:

```sh
cu task --provider compatible --model "$LOCAL_MODEL_ID" \
  --base-url http://127.0.0.1:1234/v1 --app Safari \
  --instruction 'Complete the authorized workflow and verify its final result'
```

Use `--api-key-env MY_PROVIDER_KEY` to name a different credential environment
variable, or `--base-url URL` for an explicit provider endpoint. Compatible mode
uses only `CU_API_KEY` or your chosen key variable; it does not automatically send
your OpenAI key to another server. Keep keys out of arguments and transcripts.

For repeated use, set `CU_PROVIDER`, `CU_MODEL`, and optionally `CU_BASE_URL` and
`CU_API_KEY_ENV` in your shell environment. CLI flags override those defaults.
Explicit `--provider jev` ignores inherited SDK defaults. With no model configuration,
`task` retains Jev as its default. Exact shell/MCP tools always remain model-free;
`act` still uses Jev. Model flags apply to `task` only. The Electron settings panel
has not been converted into a provider-settings UI.

SDK models receive the goal, compact observed controls/text, recent history and
caller-supplied write values. Observation text is sent to your selected provider;
screenshot pixels are not included. Existing `--visual` observations can contribute
local detector/OCR labels. The same native validation, Stop, Mac task preview and
same-app boundaries apply. There is no workflow step cap. Each decision has a
120-second timeout and one SDK retry for eligible transient request failures;
invalid decisions never trigger native input or a fallback to a different provider.

Models choose current candidate IDs and exact supplied text indices. Completion
requires a quote found in the fresh observation; the model still owns the judgment
that it proves the whole goal. This is not a calibrated Jev confidence score or
independent proof of success.

Provider serialization, invalid outputs, cancellation, and a full CLI workflow
are tested on Linux using SDK fixtures and a local HTTP server. These tests do
not establish real account access, every model's capabilities, or Mac delivery.

## Custom decision-agent adapters

For your own agent service or model integration, supply a local executable adapter:

```sh
cu task --app Safari \
  --instruction 'Complete the authorized workflow and verify its final result' \
  --agent-command /absolute/path/to/adapter \
  --agent-args '["--profile","desktop"]'
```

CU starts the adapter once per task invocation and keeps it alive across decisions
and milestones. The adapter uses its own SDK, credentials and conversation state.
Arguments are a JSON string array; CU does not invoke a shell. No TypeSafe key is
loaded for this path. This option expects the protocol below, **not the unmodified
interactive executable of a coding agent**. Existing coding agents should normally
use the shell/MCP route above, without writing an adapter.

The task retains native validation, fresh observations, repeat-action recovery,
Stop cancellation and the Mac floating preview. It has no fixed step count.
Native helper and MCP sessions also have their own preview and pause/resume
controls. Same-app task boundaries still apply to optional delegated tasks.

### Adapter protocol: `cu.agent.v1`

Read newline-delimited JSON from stdin. Every request contains:

```json
{
  "id": 1,
  "protocol": "cu.agent.v1",
  "method": "decide",
  "state": {
    "goal": "The whole workflow",
    "application": "Safari",
    "observedText": [{"role":"AXButton","text":"Save"}],
    "controls": [{"id":"a0","operation":"press","description":"Save"}],
    "history": []
  },
  "textValues": ["Exact caller-supplied value"],
  "instructions": "Decision and verification requirements"
}
```

`state` also includes partial-observation errors, recovery history and time. The
adapter must treat app content as data and preserve the user's goal and limits.
State contains compact Accessibility/optional vision descriptions, not screenshot
pixels. Adapter processes inherit the CLI environment; install only adapters you
trust with the task and observed application content.

Write exactly one JSON line to stdout for each request, echoing its `id`:

```json
{"id":1,"choice":"a0"}
```

For a write, select a caller-supplied value by zero-based index:

```json
{"id":2,"choice":"t0","textIndex":0}
```

For completion, verify every requested outcome and cite an exact nonempty quote
from one of the **current** `observedText[].text` strings:

```json
{"id":3,"choice":"done","evidence":"Changes saved"}
```

Use `{"id":3,"choice":"blocked"}` when no offered action can progress. Send logs
to stderr. Candidate IDs are local to each observation. Unknown targets, invented
write text, malformed replies and mismatched request IDs stop the task before
that decision can dispatch. Each decision has a 120-second response timeout;
responses are bounded to 1 MB. Stop cancels the request and terminates the adapter.

External-agent decisions do not use Jev confidence thresholds. CU validates the
structure, offered target, exact write value and completion quote. A quote's
presence does **not** independently prove that every goal was fulfilled; the
agent owns that judgment and the final event explicitly says so. Review the fresh
result before reporting success. Jev retains its existing confidence checks.

Linux automated tests exercise this protocol with a subprocess fixture and a
simulated native driver. Real third-party model calls and Mac delivery require
separate integration validation.
