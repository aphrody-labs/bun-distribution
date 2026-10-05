# @aphrody/xai

Headless **xAI Grok** client for Bun — OpenAI-compatible `https://api.x.ai/v1`.

**Table of Contents**

- [Auth (keyless / gratuite)](#auth-no-xai_api_key-required)
- [CLI (`aphrody-web grok`)](#cli-aphrody-web-grok)
- [High-level Library API (fluent Chat, Python SDK parity)](#library-high-level-fluent-chat-like-xai-sdk-python)
- [Native X and Grok Integration (XTools for agentic use)](#native-x-and-grok-integration)
- [Low-level API](#low-level-still-supported)
- [MCP Tools](#mcp)
- [Production-grade Notes](#production-grade-grok-and-native-x)

## Auth (no `XAI_API_KEY` required)

After `grok login`, Grok Build stores an OIDC JWT in `~/.grok/auth.json`. This package uses that token as `Authorization: Bearer …` (same as the Grok CLI).

Resolution order:

1. Explicit `bearer` option / `--bearer`
2. `XAI_API_KEY` environment variable (metered `xai-…` key)
3. `~/.grok/auth.json` → `key` field (OIDC)

**SuperGrok / free access (gratuite)**: set `SUPER_GROK_TOKEN` (or `GROK_SUPER_TOKEN`) env or use `~/.grok/auth.json` (from `grok login`). No paid `xai-` key needed. Full compatibility: explicit non-`xai-` bearer or SUPER_* env forces `supergrok` mode (preferred before falling back to auth file). The client detects non-`xai-` tokens as `supergrok` / `grok_oidc` mode. Use for agent flows without metered billing.

## CLI (`aphrody-web grok`)

```bash
aphrody-web grok whoami
aphrody-web grok models
aphrody-web grok chat "Hello"
aphrody-web grok chat "Hi" --model grok-4 --stream
aphrody-web grok tts "Hello" --output /tmp/out.mp3
aphrody-web grok stt recording.wav
aphrody-web grok raw GET /models
```

## Library (high-level fluent Chat like xai-sdk-python)

The high-level API provides a stateful `Chat` session for multi-turn conversations, tool calling, streaming, structured outputs, and reasoning — directly inspired by the Python xai-sdk.

```ts
import { XaiClient, system, user } from "@aphrody/xai"; // (add helpers if you want)

const client = new XaiClient(); // keyless via ~/.grok/auth.json (SuperGrok / Grok OIDC) or SUPER_GROK_TOKEN

// High-level multi-turn (append + sample/stream)
const chat = client.createChat("grok-3", {
  messages: [system("You are a helpful pirate.")],
});
chat.append(user("Hello!"));
const res = await chat.sample();
console.log(res.choices[0]?.message?.content);
chat.append(res); // continue conversation

// Streaming
for await (const { content, done } of chat.stream()) {
  if (!done) process.stdout.write(content);
}

// Advanced: reasoning, structured (zod or simple json), tool-calling (see Native X section below)
const chatAdv = client.createChat("grok-4", {
  reasoning_effort: "high",
  response_format: { type: "json_object" },
});
const structured = await chatAdv.sampleStructured(); // basic zod/.parse or json auto
console.log(structured.parsed);
```

See the full `Chat` API in the Quick Reference below and source `src/core/client.ts`. Tool-calling with native X fulfillment is shown in the "Native X + Grok integration" section.

## Native X and Grok integration

For a bounded X-assisted research run, use the library function below. An Aphrody Web Actor
can call it and store the returned result through its own Actor SDK; this package does not
depend on the Actor runtime.

```ts
import { runGrokXResearch } from "@aphrody/xai";

const result = await runGrokXResearch({ query: "Aphrody release news", maxToolRounds: 4 });
// { answer, toolRounds, toolCalls, stopReason: "completed" | "round_limit" }
```

It registers the five native X tools on the Grok chat, executes X tool calls through
`XTools`, and stops after the configured number of tool rounds. `answer` is `null` when
the round limit is reached. For tests or an existing session, pass `{ client, xTools }`
as the second argument.

Analyse of our stack:
- `@aphrody/x`: native cookie-auth X/Twitter client: a thin Bun import over the Rust crate `aphrody-x` (through the `aphrody-ffi` library), with batch jobs for mass scripting. It owns the X function tools; this package re-exports them and keeps no X client of its own.
- `packages/xai`: this package, now with high-level fluent Chat (create/append/sample/stream) + low-level OpenAI compat, using the same keyless SuperGrok token.

Use them together for agentic Grok: let Grok decide to call an `x_search` tool, then fulfill it with the native `XClient` from `@aphrody/x` (no extra keys, fully local/native).

Example tool handler (user code):
```ts
import { XClient } from "@aphrody/x";
const x = new XClient(session);
if (tool.name === "x_search") {
  const results = await x.search(args.query, args.count);
  // feed back as tool result to chat.append( tool_result(...) )
}
```

Using built-in XTools (recommended):
```ts
import { XaiClient, XTools, xSearchToolDef, xWhoamiToolDef, xTweetsToolDef, xNewsToolDef } from "@aphrody/xai";
const grok = new XaiClient();
const xTools = new XTools(); // the native X client: credentials discovered by Rust, no extra keys

const chat = grok.createChat("grok-3", { tools: [xSearchToolDef, xWhoamiToolDef, xTweetsToolDef, xNewsToolDef] });
// after Grok returns a tool_call e.g. for x_tweets or x_news:
const toolRes = await xTools.tweets({ handle: "aphrody", count: 5 });
// or await xTools.news({count:3}); await xTools.whoami();
chat.append({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolRes) });
const final = await chat.sample();
```

XTools now covers key X actions for Grok agentic use (all use the native @aphrody/x XClient under the hood for zero extra keys, full stealth, and local SQLite state):

- `search({query, count?, mode?})`: Latest/Top search.
- `profile({handle})`: User profile.
- `whoami()`: Authenticated viewer.
- `tweets({handle, count?})`: User timeline.
- `news({count?})`: Explore/trending news.

**Testability**: XTools constructor accepts an optional pre-built (or mocked) XClient instance for unit testing without real network or auth:

```ts
const mockX = { search: async (q) => ({tweets: [...]}) /* etc */ };
const xTools = new XTools(mockX);
```

Corresponding tool defs (`xSearchToolDef`, etc.) and the `xNativeTools` array are exported for easy use in `createChat({ tools: xNativeTools })`.

`XTools` and the tool definitions are owned by `@aphrody/x` in aphrody-web (`packages/x/src/tools/function-tools.ts`, which also provides `XTools.execute(name, args)` and `isXToolName`); this package re-exports them. The dependency points one way: the AI layer consumes the web layer.

Simple agent loop with native X tools:
```ts
const grok = new XaiClient();
const xTools = new XTools();
const chat = grok.createChat("grok-3", { tools: xNativeTools as any });

chat.append(user("What's the latest on aphrody-web or xai on X?"));
let res = await chat.sample();

while (res.choices[0]?.message?.tool_calls?.length) {
  const n = await chat.executeToolCalls({
    x_search: (a) => xTools.search(a),
    x_profile: (a) => xTools.profile(a),
    x_whoami: () => xTools.whoami(),
    x_tweets: (a) => xTools.tweets(a),
    x_news: (a) => xTools.news(a),
  });
  if (n === 0) break;
  res = await chat.sample();
}
console.log(res.choices[0]?.message?.content);
```

## Low-level (still supported)

```ts
import { XaiClient } from "@aphrody/xai";

const client = new XaiClient();
const models = await client.listModels();
const reply = await client.complete("Explain Rust in one line", "grok-3-mini");
```

## MCP

- `aphrody_web_grok_whoami`
- `aphrody_web_grok_models`
- `aphrody_web_grok_chat` (now also supports high-level via the package)

## API Quick Reference (high-level)

```ts
// Chat session
const chat = client.createChat(model, { messages?, tools?, reasoning_effort?, response_format?, ... });
chat.append(msgOrStringOrResponse);
const res = await chat.sample();
const stream = chat.stream(); // yields {content?, toolCallDeltas?, toolCalls?, done, response?}
const n = await chat.executeToolCalls({ toolName: (args) => impl(args) }); // returns #executed
const structured = await chat.sampleStructured<T>(schema?); // { ...res, parsed? }

// XTools (for Grok tool fulfillment or direct use)
const xTools = new XTools(sessionOrMockClient?);
await xTools.search({query, count?, mode?});
await xTools.profile({handle});
await xTools.whoami();
await xTools.tweets({handle, count?});
await xTools.news({count?});
```

See `src/core/client.ts` (Chat + XaiClient), `src/index.ts` (exports, including `XTools`, every `*ToolDef` and `xNativeTools` re-exported from `@aphrody/x`).

Runnable example: [packages/xai/examples/grok-x-agent.ts](examples/grok-x-agent.ts) (full agent loop with native X fulfillment).

## Production-grade Grok and native X

The combo `@aphrody/xai` (Chat + XTools) + `@aphrody/x` (XClient) supports Grok tool calls for X search, tweets, news, identity and profiles. XTools uses the published X client; unit tests use mock clients and do not require a live API.

See also the `@aphrody/x` package in `packages/web/x` and the tests in this package.

## Contributing & Notes

- Keep packages light (dynamic zod for structured if present at runtime).
- Prefer tools + XTools for agentic X access over legacy search_parameters.
- `@aphrody/x` is integrated directly from `packages/web/x` via Bun workspace (`@aphrody/x: "workspace:*"`).
- Tests: `bun run test` from `packages/xai` (unit-only by default; live opt-in via env flags). Coverage includes Chat, XTools, native X dispatch and the bounded research helper.

See `index.test.ts` and `agent.test.ts` for details (all mocks, no live service required for core coverage).
