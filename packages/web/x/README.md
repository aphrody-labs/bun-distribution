# @aphrody/x

Headless **X (Twitter)** client for Bun, built for mass scripting. It is a thin import over the Rust crate `aphrody-x` (`crates/web/x`), reached in process through the `aphrody-ffi` library (`@aphrody/bun/x`): the client, parsers, store, retry, rate-limit waiting, pacing and checkpoint are Rust, one implementation shared with the `aphrody x` CLI and the MCP tool. Cookie-auth GraphQL + REST, no official API key required. Local state (SQLite store + FTS), catalog sync, and X function tools (`XTools`) that let Grok or any tool-calling model use X.

**Zero keys, fully native**: Uses real browser cookies (`auth_token` + `ct0`) and a query ID catalog synced from live X bundles. The native library is opened by the first call, never on import.

**Table of Contents**

- [Key Features](#key-features)
- [Auth (cookie-based, no X API key)](#auth-cookie-based-no-x-api-key)
- [Usage](#usage)
  - [Basic](#basic)
  - [Mass scripting (batch jobs)](#mass-scripting-batch-jobs)
  - [Ranking with local For You algo (no ML model needed)](#ranking-with-local-for-you-algo-no-ml-model-needed)
  - [X function tools (Grok and other tool-calling models)](#x-function-tools-grok-and-other-tool-calling-models)
- [CLI (`aphrody-web x`)](#cli-aphrody-web-x)
- [Advanced / Internal](#advanced--internal)
- [MCP](#mcp)
- [Installation & Build](#installation--build)
- [Relation to aphrody-web and aphrody-ai](#relation-to-aphrody-web-and-aphrody-ai)
- [License](#license)

## Key Features

- **Core operations**: `whoami`, `profile` (userByScreenName), `tweets` (user timeline), `search` (Latest/Top), `news` (Explore tabs / trending).
- **Advanced**: X Pro / Gryphon decks (radar, columns, sync), Radar keyword search, premium upsells, media upload, archive import/export, local SQLite store with edges/FTS search/digest.
- **Algo (For You ranking)**: Local X For You style re-ranking (`rankPosts`, `rankTweets`, `toPostCandidate`/`tweetToPostCandidate`) ported/adapted from [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm). Filters (dupe, self, blocked, muted, age), weighted scoring (engagement proxy + in-network/history/freshness bonuses), author diversity attenuation. Mirrors the Rust `x-algorithm` crate.
- **X function tools**: `XTools` + OpenAI-compatible tool definitions (`x_search`, `x_profile`, `x_whoami`, `x_tweets`, `x_news`, all in `xNativeTools`) fulfil model tool calls locally with the real XClient (stealth + store). Used by bxc's `grok-x-research` actor and by `@aphrody/xai` in aphrody-ai.
- **Autonomous follow purge**: `purgeFollowing()` empties the whole following list, accounts that don't follow back first, with a three-brake rate governor (randomised pacing + rolling 15 min / 24 h budgets + `x-rate-limit-*` headers) and a resumable on-disk journal. See [Autonomous follow purge](#autonomous-follow-purge).
- **Autonomous post purge**: `purgeTweets()` deletes your own tweets, replies and media below a like threshold, least-liked first, walking all three timelines. Shares the rate governor and resumable journal with the follow purge. See [Autonomous post purge](#autonomous-post-purge).
- **Mass scripting**: `xBatch` runs thousands of operations with bounded concurrency, retry, rate-limit waiting, pacing and a resumable JSONL checkpoint, all inside Rust. See [Mass scripting](#mass-scripting-batch-jobs).
- **One implementation**: requests, cookie rotation, queryId recovery, parsing, the store and the error taxonomy live in `aphrody-x`; this package keeps the names, the types and the orchestration (purges, radar, crawler, cron, function tools).

See `src/core/client.ts` (the thin client), `src/batch.ts`, `src/algo.ts`, `src/tools/*` (`function-tools.ts` for `XTools`), `src/services/*`, `src/db/*`.

## Auth (cookie-based, no X API key)

Uses `auth_token=...; ct0=...` (from logged-in X web session).

Resolution, owned by Rust and identical to `aphrody x` (`new XClient()` with no argument):

1. `X_COOKIE_STRING`.
2. Session file `~/.aphrody/x-session.json`.
3. `X_AUTH_TOKEN` + `X_CT0` env.

```ts
import { XClient, XSession } from "@aphrody/x";

const client = new XClient(); // discovery, as above
// or explicit: new XClient(XSession.fromCookieString("auth_token=...; ct0=..."))
// or a session file (a rotated ct0 is written back to it by Rust): new XClient(XSession.load())
```

The credentials cross the native boundary once, when the client opens; they are never part of a result or a checkpoint.

**Cookie management**: Use aphrody-web CLI `aphrody-web cookies ...` or the tools in `src/cookies` (in root aphrody-web).

## Usage

### Basic

```ts
import { XClient, XSession } from "@aphrody/x";

const session = XSession.loadOrEnv();
const client = new XClient(session);

const user = await client.whoami();
console.log(user);

const profile = await client.userByScreenName("aphrody_code");
const tweets = await client.userTweets(profile.id, 20);

const search = await client.search("bun runtime", 10); // Latest by default
const news = await client.getNews(5);
```

### Mass scripting (batch jobs)

```ts
import { XClient, xBatch } from "@aphrody/x";

const client = new XClient();
const run = xBatch(
  client,
  handles.map((handle) => ({ id: handle, op: "user_by_screen_name", args: { handle } })),
  {
    concurrency: 8,
    checkpoint: "users.jsonl", // a rerun replays the final results instead of running them again
    retry: { maxRetries: 3 },  // transient failures, idempotent operations only
    onProgress: ({ completed, total }) => console.error(`${completed}/${total}`),
  },
);
for await (const result of run) {
  if (result.ok) save(result.data);
  else console.error(result.id, result.error.kind, result.error.message);
}
console.log(run.summary); // { total, ok, failed, resumed, not_run, elapsed_ms, stopped_by }
```

Operations are the Rust method names in snake case (`create_tweet`, `like`, `user_tweets`, `get_news`,
`graphql`, ...); `xLocal("meta")` serves the table with arguments, mutation and retry class. One failing
operation never stops the others, except an `auth` failure (a dead session): dispatch stops and the rest is
reported `not_run`. `error.kind` is `auth`, `terminal`, `rate_limit`, `transient`, `invalid` or `other`,
classified once in Rust (`crates/web/x/data/x-policy.json`). Mutations can be paced with `pacing`
(`minDelayMs`, `maxDelayMs`, `perWindow`, `perDay`, `reserve`). `signal` or `run.cancel()` aborts the
operations in flight; the checkpoint keeps every completed result. A single call with the same machinery:
`await client.call("search", { query: "bun", all: true, max_pages: 5 })`.

### Ranking with local For You algo (no ML model needed)

```ts
import { rankTweets, tweetToPostCandidate } from "@aphrody/x";

const results = await client.search("aphrody-web browser engine");
const candidates = results.tweets.map(t => tweetToPostCandidate(t, /* inNetwork? */ false));
const ranked = rankTweets(results.tweets, {
  viewer_id: user.id,
  followed_author_ids: [...],
  recent_engagement_author_ids: [...],
  muted_keywords: ["spam"],
  now_unix: Math.floor(Date.now()/1000),
}, 10);

console.log(ranked[0].post.text, ranked[0].score, ranked[0].reasons);
```

See `src/algo.ts` for `rankPosts`, filters, scoring (engagement + in_network + diversity), and conversions.

### X function tools (Grok and other tool-calling models)

Pass `xNativeTools` as the `tools` of an OpenAI-compatible chat request; when the model answers with
`tool_calls`, run each one with `XTools.execute` and send the result back as a `tool` message. The
model client stays with the caller (bxc's `grok-x-research` actor, `@aphrody/xai` in aphrody-ai).

```ts
import { XTools, isXToolName, xNativeTools } from "@aphrody/x";

const xTools = new XTools(session); // XSession, cookie string, or an injected client in tests
// request: { model, messages, tools: xNativeTools }
for (const call of reply.choices[0].message.tool_calls ?? []) {
  if (!isXToolName(call.function.name)) continue;
  const result = await xTools.execute(call.function.name, JSON.parse(call.function.arguments));
  messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
}
```

`XTools` exposes `search`, `profile`, `whoami`, `tweets` and `news` directly, and `execute(name, args)`
validates the model's arguments before dispatching.

## CLI (`aphrody-web x`)

```bash
aphrody-web x whoami
aphrody-web x profile elonmusk
aphrody-web x tweets elonmusk --count 20
aphrody-web x search "bun runtime" --count 10
aphrody-web x news --count 5
aphrody-web x rank "query"   # or foryou (uses local algo + X data)
aphrody-web x unfollow       # plan the follow purge (dry-run, no mutation)
aphrody-web x unfollow --yes # execute it
aphrody-web x purge-tweets                  # plan the post purge (dry-run)
aphrody-web x purge-tweets --yes --max-likes 1000   # delete everything under 1000 likes
```

See root CLI for `aphrody-web x rank` / `foryou` (local X For You re-ranking).

## Autonomous follow purge

Empties the authenticated account's following list, **accounts that don't follow
back first**, then mutuals. Built for lists in the thousands, where the binding
constraint is the rate limit rather than the work itself.

```ts
import { XClient, XSession, purgeFollowing } from "@aphrody/x";

const client = new XClient(XSession.loadOrEnv());

// Plan only — reads the graph, mutates nothing.
const plan = await purgeFollowing(client, { onLog: console.error });
console.log(plan.non_mutual_total, "non-mutuals /", plan.following_total, "abonnements");

// Execute. Stop it whenever; the next call resumes from the journal.
const run = await purgeFollowing(client, { dryRun: false, onLog: console.error });
```

### Three brakes on every mutation

`POST friendships/destroy.json` is throttled and bursts are a known automation
signature, so `RateGovernor` clears three independent budgets before each call:

| Brake | Default | Purpose |
| --- | --- | --- |
| Randomised delay | 4–11 s | breaks up the machine-gun cadence |
| Rolling 15 min window | 45 | stays under the per-window ceiling |
| Rolling 24 h | 400 | stays under the unofficial ~500/day ceiling |

On top of that it reads `x-rate-limit-remaining` / `x-rate-limit-reset` from
every response (captured by `XClient.request`) and waits out the reset once the
remaining count drops to the reserve. A 429 or API code 88 triggers a full
back-off and a retry of the *same* target — a throttle is not a strike against
the account being removed.

### Autonomy and resumption

A 4 000-account list at 400/day spans ten days, so the run persists a journal
after **every** mutation to `~/.aphrody/x-unfollow-<handle>.json` (mode 0600,
atomic rename):

- Stop it at any point — Ctrl-C, `AbortSignal`, budget exhaustion, a dead
  session — and call it again to continue from the exact same position.
- The follow graph is read once and reused; `refresh: true` re-reads it.
- Rolling budgets survive restarts, so relaunching in a loop can't burst.
- Left running, it sleeps through window and day boundaries by itself until the
  queue is empty. `once: true` returns instead of sleeping (used by the MCP tool).

### Error handling

| Situation | Behaviour |
| --- | --- |
| Suspended / deleted / already unfollowed (34, 50, 63, 108, 162, 404) | recorded as `skipped`, never retried |
| Rate limit (88, 429) | back off to the reset, retry the same target |
| Persistent rate limit (6 consecutive waits) | stop the run, keep the target queued |
| Transient (5xx, network) | exponential backoff, up to `maxRetries` (3), then `failed` |
| Auth (32, 89, 99, 215, 401, 403) | abort immediately — a rotated cookie must not be burned through the queue |

### Options

`dryRun` (default `true`), `limit`, `nonMutualOnly`, `refresh`, `once`,
`statePath`, `persist`, `perWindow`, `perDay`, `minDelayMs`, `maxDelayMs`,
`reserve`, `maxRetries`, `maxRateLimitWaits`, `maxPages`, `pageSize`, `signal`,
`onLog`, `onProgress`, plus `now` / `sleep` / `random` for deterministic tests.

Building blocks are exported separately: `captureFollowGraph`, `collectFollowing`,
`collectFollowers`, `buildQueue`, `loadState`, `saveState`, `estimateEta`,
`RateGovernor`.

## Autonomous post purge

Deletes your own tweets, replies and media posts below a like threshold —
**least-liked first**, so stopping early always means the deadest posts are the
ones already gone.

```ts
import { XClient, XSession, purgeTweets } from "@aphrody/x";

const client = new XClient(XSession.loadOrEnv());

// Plan only — walks the timelines, deletes nothing.
const plan = await purgeTweets(client, { maxLikes: 1000, onLog: console.error });
console.log(plan.queued, "posts sous le seuil /", plan.posts_total, "au total");

// Execute. Stop it whenever; the next call resumes from the journal.
await purgeTweets(client, { maxLikes: 1000, dryRun: false, onLog: console.error });
```

### Three timelines, one archive

None of X's user timelines is a superset of the others: `UserTweets` drops
replies, `UserMedia` only carries media. All three are walked and deduped by id,
which is what makes "everything under N likes" actually true rather than
"everything under N likes that happened to be on one tab".

### What gets deleted

| Kind | In scope by default | Mutation |
| --- | --- | --- |
| `tweet` | yes | `DeleteTweet` |
| `reply` | yes | `DeleteTweet` |
| `media` | yes | `DeleteTweet` |
| `retweet` | **no** | `DeleteRetweet` |

Retweets are off by default because a retweet's like count belongs to someone
else's post — the "under N likes" rule says nothing about it. Turn them on with
`includeRetweets: true` and they are queued on scope alone, regardless of count.

Detecting them is not obvious: on a user timeline X attributes a retweet to the
**retweeter**, so `author_id` is your own id and an author check never fires.
`classifyPost` therefore also matches the legacy `RT @handle:` prefix. Getting
this wrong is not cosmetic — a misclassified retweet is treated as your own post
and deleted by a purge that was told to leave retweets alone.

The same attribution decides the mutation: a payload attributed to you carries
your own retweet status, which `DeleteTweet` removes; one carrying the original
tweet needs `DeleteRetweet`.

A reply carrying an image classifies as `reply`, not `media`: the reply nature
is the more specific fact, and both are in scope anyway.

`maxLikes` is a strict floor — a post sitting at exactly 1000 likes is **kept**.
`protectIds` spares specific posts (pinned post, keepsakes).

### Shared with the follow purge

Pacing (three brakes: randomised delay, rolling 15 min and 24 h budgets, plus
the `x-rate-limit-*` headers), the error taxonomy, and the mutation loop all
live in `purge-engine.ts`, so a fix in one purge is a fix in both. See
[Autonomous follow purge](#autonomous-follow-purge) for the details.

Reads are protected too: building the queue means walking hundreds of pages, so
`readWithBackoff` waits out a mid-walk 429 and retries the same page instead of
throwing away everything already fetched.

Truncation is always reported. A walk stopped early — by `maxPages` or by an
abort signal — sets `complete: false`, so a partial archive can never be mistaken
for full coverage and silently purged as if it were.

### Options

`dryRun` (default `true`), `maxLikes` (default 1000), `kinds`,
`includeRetweets`, `protectIds`, `limit`, `refresh`, `once`, `statePath`,
`persist`, plus every pacing knob and `signal` / `onLog` / `onProgress`.

Building blocks are exported separately: `captureArchive`, `collectTimeline`,
`buildTweetQueue`, `classifyPost`, `loadTweetState`, `saveTweetState`.

## Advanced / Internal

- **Store & state**: SQLite with tweet/user/community edges, FTS5 search, digest, archive import.
- **Catalog & recon**: Dynamic query IDs from X JS bundles (`bun scripts/tools/web/x-catalog-sync.ts`, native `catalog_sync`), surface recon, premium graph.
- **X Pro / Radar**: Decks, columns, radar search (see `src/services/x-pro-deck.ts`, `src/config/radar-surface.ts` and `docs/web/x/X_PRO.md`).

## MCP

- `aphrody_web_x_client` (profile, tweets, search, news, whoami, rank/foryou via algo)
- `aphrody_web_x_unfollow_purge` (autonomous follow purge — plan-only unless `confirm: true`)
- `aphrody_web_x_purge_tweets` (autonomous post purge — plan-only unless `confirm: true`)
- `aphrody-web_xpro_deck` (decks + radar)
- Grok research with native X tools: the bxc `grok-x-research` actor.

## Installation & Build

```bash
bun add @aphrody/x
# or in workspace: bun install (monorepo)
```

Main entry: `src/index.ts` (re-exports core, services, algo, etc.).

`package.json` lists concrete version ranges: within the monorepo, `@aphrody/xai`
consumes `@aphrody/x` via `workspace:*`.

## Relation to web and AI layers

This is the Bun face of the headless X client (Rust `aphrody-x`) powering the `aphrody web x` CLI, recon, and MCP. The AI layer consumes it, never the reverse: `@aphrody/xai` depends on this package for `XTools` in its Grok agent loops (keyless SuperGrok OIDC + cookie X = zero external keys).

See:
- Root `README.md` and `AGENTS.md`
- [packages/ai/xai/README.md](../../ai/xai/README.md) (high-level Grok Chat SDK)
- `src/cli/x.ts`, `src/mcp/server.ts`
- `docs/web/x/` (X_PRO.md, COVERAGE.md, PREMIUM.md)
- Examples in `examples/`

**Production notes**: Cookie sessions expire/rotate; use stealth profiles; prefer local algo + store over repeated live calls. All verified in unit tests (no live required for core + algo).

## Testing

See `x-native.test.ts` for the client, batches, store and policy data over the real library (loopback server, skipped until the cdylib exists), `index.test.ts` for units (catalog, store, archive, algo/ranking, ingest/RAG), `function-tools.test.ts` for `XTools` and the tool definitions, and `unfollow.test.ts` / `purge-tweets.test.ts` for the purge engines (queue ordering, rate governor budgets, error taxonomy, read backoff, journal resume — all on an injected clock, no live calls). Integration tests skip without session.

Run: `bun test packages/x`

The Grok tool loop is tested in `apps/bxc/test/unit/grok-x-research-actor.test.ts`.

## License

Apache-2.0 (see root).

Contribute via the aphrody-web monorepo (catalog sync, new surfaces, more algo features, etc.).
