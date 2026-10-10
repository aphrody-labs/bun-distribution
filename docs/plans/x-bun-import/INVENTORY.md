<!-- SPDX-License-Identifier: Apache-2.0 -->
# `@aphrody/x` against `aphrody-x`: inventory

> Path reconciliation (2026-10-07): `data/x-policy.json` (not in repo) → `crates/web/x/data/x-policy.json`. Original dated observations below retain their historical scope.

Date: 2026-10-05. Scope: `packages/web/x` (TypeScript, 47 files) against `crates/web/x` (Rust crate `aphrody-x`) and the
in-process FFI (`crates/interop/ffi`, package `@aphrody/bun`). Companion: [PLAN.md](PLAN.md) (design and decisions).

Owner request (French, verbatim): « x est originellement en Rust ; migre son package x en import Bun pour du scripting
de masse pour usage web ». The owner settled that no licence concern applies (multi-licensed monorepo) and that every
decision is mine: each is recorded as `tranché` below and executed.

Every row was read from source on 2026-10-05; line counts are `wc -l` of the tree at `be67fd6e2`.

## 1. Legend

| Column | Meaning |
| --- | --- |
| (a) Rust | the function of `aphrody-x` that already does the job (`crates/web/x/src/<module>.rs`) |
| (b) FFI | the `aphrody-ffi` export that reaches it today (`aphrody_web_x_*` or the generic `aphrody_run_captured`) |
| (c) CLI | the `aphrody x ...` command (multicall tool `x`, alias `x-cli`) |
| (d) TS-only | logic that exists only in TypeScript today |
| Decision | `port` (move to Rust), `thin` (keep as TypeScript orchestration over the native client), `data` (data or types only, no logic), `drop` (dead or superseded) |

State today: the Rust crate is complete for the client domain (8,012 lines). The FFI reaches five reads and the ranker:
`aphrody_web_x_user_by_screen_name`, `_user_tweets`, `_community_by_rest_id`, `_community_tweets`,
`_community_info_and_tweets` (each with a `_submit` job variant) and `aphrody_web_x_algorithm_rank`. Every write, every
timeline read other than the user timeline, the store, the news, media, premium and X Pro paths are not reachable
in-process: the TypeScript package re-implements them.

## 2. Public exports of `@aphrody/x` (`packages/web/x/src/index.ts`)

### 2.1 Session and client

| TS export | (a) Rust | (b) FFI | (c) CLI | (d) TS-only | Decision |
| --- | --- | --- | --- | --- | --- |
| `XSession`, `XSessionData` (`core/session.ts`, 120 lines) | `XSession::{new, load, from_env, load_or_env, from_cookie_string, cookie_header}` (`session.rs`) | none (`auth_token` and `ct0` are passed as strings on every call) | `--cookie-string`, `X_COOKIE_STRING`, `x check` | `save()` after cookie rotation | `thin` value object (constructible without the native library, so `new XTools("auth_token=...; ct0=...")` keeps working in unit tests). Discovery order and file format are owned by Rust: `XClient.open()` with no session resolves it natively. Rotation persistence moves to Rust (`persist_session`). |
| `API_BASE` | `client::API_BASE` | none | none | constant | `data` (constant in `src/surface.ts`, parity-tested against the native `meta` op) |
| `XClient` (`core/client.ts`, 1,016 lines) | `XClient` (`client.rs`, `api.rs`, `news.rs`, `media.rs`, `premium.rs`, `x_pro_deck.rs`) | 5 reads | all commands | see below | `port` the missing pieces, then replace the class by a binding with the same method names |
| `RateLimit`, `TweetResult`, `UserInfo`, `ListInfo`, `TimelineTweet` | `RateLimit`, `TweetResult`, `UserInfo`, `ListInfo`, `TimelineTweet` | none | none | types | `data` (types follow the Rust serde shapes) |

`XClient` methods, one by one (all methods of `core/client.ts`):

| TS method | (a) Rust | (b) FFI | (c) CLI | Decision |
| --- | --- | --- | --- | --- |
| `createTweet`, `createTweetWithMedia`, `createTweetRest` | `create_tweet`, `create_tweet_with_media`, `create_tweet_rest` | none | `post`, `reply` | native op `create_tweet`, `create_tweet_rest` |
| `deleteTweet`, `like`, `unlike`, `retweet`, `unretweet`, `bookmark`, `unbookmark`, `pinTweet`, `unpinTweet` | same names in snake case | none | `delete`, `like`, `unlike`, `retweet`, `unretweet`, `bookmark`, `unbookmark`, `pin`, `unpin` | native ops |
| `noteTweet` | `note_tweet` | none | `note` | native op |
| `follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute` | same | none | same | native ops |
| `sendDm` | `send_dm` | none | `dm` | native op |
| `userByScreenName` | `user_by_screen_name` | `aphrody_web_x_user_by_screen_name(_submit)` | `user` | native op (the TS method also rode `graphqlWaiting`: the native client waits out soft rate limits) |
| `homeTimeline` | `home_timeline` | none | `timeline` | native op |
| `timelineTweets`, `timelineUsers` | private `timeline_tweets`, `timeline_users` | none | none | `port`: made public, native ops `timeline_tweets`, `timeline_users` |
| `userIdFor` | `user_id_for` | inside `_user_tweets` | inside `user-tweets` | native op |
| `getTweet`, `thread`, `tweetDetailRaw` | `get_tweet`, `thread`, private `tweet_detail_raw` | none | `read`, `thread`, `replies` | native ops (`tweet_detail_raw` made public) |
| `search` | `search` | none | `search`, `mentions` | native op; gains `query_source` (used by Radar) |
| `userTweets` | `user_tweets` | `aphrody_web_x_user_tweets(_submit)` | `user-tweets` | native op |
| `userTweetsAndReplies`, `userMedia` | none | none | none | `port` to Rust (`user_tweets_and_replies`, `user_media`): small, X client domain, needed by the post purge |
| `home` | `home` | none | `home` | native op |
| `likes`, `bookmarks`, `following`, `followers`, `listTimeline`, `lists` | same | none | `likes`, `bookmarks`, `following`, `followers`, `list-timeline`, `lists` | native ops |
| `communityByRestId`, `communityTimeline`, `communityInfoAndTimeline` | `community_by_rest_id`, `community_timeline`, `community_info_and_timeline` | `aphrody_web_x_community_*` (3, with `_submit`) | `community-timeline`, `community-info` | native ops |
| `whoami` | `whoami` | none | `whoami` | native op |
| `uploadMedia` | `upload_media` (`media.rs`) | none | `upload-media` | native op; the TS port (`services/media.ts`, 199 lines) is dropped |
| `getNews` | `get_news` (`news.rs`) | none | `news` | native op |
| `graphql`, `graphqlWaiting` | `graphql`, `graphql_waiting` | none | `graphql [--wait]` | native op `graphql` (`wait`, `max_wait_secs`) |
| `request(url, init)` | none (private reqwest client) | none | none | `port`: native op `request` (authenticated, host-allowlisted: cookies never leave the X hosts); the TS class rebuilds a `Response` |
| `authHeaders`, `transactionId`, `captureRateLimit`, `clientUuid`, `clientDeviceId` | `auth_headers`, `transaction_id`, `capture_rate_limit` (internal) | none | none | `drop` from the TS surface (internal to the native client); `lastRateLimit` stays, fed by every result envelope |
| cookie rotation on `Set-Cookie` and `session.save()` | none: the static `Cookie` default header defeats the reqwest jar | none | none | `port`: dynamic `ct0`/`auth_token` per request, rotation persisted to the session file (0600, atomic) |
| retry on 502, 503, 504 and network errors | none | none | none | `port`: Rust retry policy (idempotent operations only, see PLAN.md) |
| 414 to POST-hybrid fallback | 404 only | none | none | `port` into `graphql` |

### 2.2 Parsing, schemas and errors

| TS export | (a) Rust | (b) FFI | (c) CLI | (d) TS-only | Decision |
| --- | --- | --- | --- | --- | --- |
| `walkTimelineTweets`, `walkTimelineUsers`, `parseSingleTweet`, `parseTweetResult`, `parseUserResult` (`core/parse.ts`, 356 lines) | `parse::{walk_timeline_tweets, walk_timeline_users, parse_single_tweet, parse_tweet_result, parse_user_result}` | none | used by every reading command | none (literal port) | `drop` the TS port; pure native ops `parse_*` (synchronous, no network) |
| tweet `media[]` (`type`, `url`, `preview_url`, `video_url`, `width`, `height`, `expanded_url`) | none: `Tweet` has no media field | none | none | yes (used by the post purge to classify `media` posts) | `port`: `Tweet.media` added to the Rust parser |
| `XError`, `checkApiErrors` | `XError`, `check_api_errors` (`pub(crate)`) | `{"error": "..."}` strings | exit code 1 | class with `code`, `status` | `thin` class; `kind` (`auth`, `terminal`, `rate_limit`, `transient`, `invalid`, `other`), `code`, `status` come from the Rust classifier (`policy.rs`) |
| `Author`, `Tweet`, `TweetPage`, `User`, `UserPage` | `Author`, `Tweet`, `TweetPage`, `User`, `UserPage` | JSON of the same shapes | JSON output | zod types | `data` |
| `AuthorSchema`, `TweetSchema`, `UserSchema`, `ListInfoSchema` (`core/schemas.ts`, 56 lines) | none | none | none | zod schemas | `data`: kept as the TypeScript type source; the payloads are produced and validated by Rust |
| `core/features.ts` (189 lines): `featuresFor`, `DEFAULT_FEATURES`, `CREATE_TWEET_FEATURES_KNOWN_GOOD` (not exported by the package index; used by tests and the client) | `features::{default_features, features_for, CREATE_TWEET_FEATURES_KNOWN_GOOD}` (~150 flags) | none | none | duplicate table | `drop`; native op `features_for` |

### 2.3 Catalog, query ids, surface constants

| TS export | (a) Rust | (b) FFI | (c) CLI | (d) TS-only | Decision |
| --- | --- | --- | --- | --- | --- |
| `getOperation`, `allOperations`, `queries`, `mutations`, `Operation` (`config/catalog.ts` (not in repo), 52 lines) | `catalog::{operation, all, queries, mutations}`; data `crates/web/x/data/x-graphql-catalog.json` | none | `catalog [--mutations] [--filter]` | indexes the same JSON; a second copy of the Gryphon JSON (`config/gryphon-graphql-catalog.json` (not in repo), semantically equal) | `data`: the accessor imports the single shared JSON files of the crate (no logic duplicated); the Gryphon copy is deleted. Native ops `catalog_get`, `catalog_list` for hosts without a bundler |
| `QueryIdStore`, `QueryIdSnapshot` (`config/query-ids.ts` (not in repo), 186 lines) | `QueryIdStore`, `Snapshot` (`runtime_query_ids.rs`) | none | `query-ids [--refresh]` | duplicate (and the same bug: a one-operation refresh overwrote the other cached ids) | `drop` the port; thin `QueryIdStore` class over native ops `query_ids_snapshot`, `query_ids_get`, `query_ids_refresh`; Rust fixes the overwrite and coalesces concurrent refreshes (single flight) |
| `syncCatalogFromBundles`, `fetchLiveQueryIds`, `discoverBundleUrls`, `extractAllOperationsFromJs` (`packages/web/x/src/tools/bundle-catalog.ts`, 179 lines) | `catalog_sync::sync_catalog_file`, `runtime_query_ids::{discover_bundles_public, fetch_and_extract_all}` | none | `catalog --sync` (path fixed at compile time) | duplicate | `drop` the TS implementation; native op `catalog_sync { path }`; `scripts/tools/web/x-catalog-sync.ts` calls it and still maintains the shared JSON |
| `X_DISCOVERY_PAGES`, `X_DISCOVERY_UA`, `X_RECON_URLS`, `X_SDK_COVERAGE`, `X_REST_V1_1`, `X_CDN`, `PREMIUM_ROUTES`, `PREMIUM_GRAPHQL_OPS`, `PREMIUM_PRODUCT_SKUS`, `PREMIUM_PAGE_URL`, `PREMIUM_PAYMENT_HOSTS`, `X_API_ENDPOINTS` (`config/x-surface.ts` (not in repo), 158 lines) | `surface::{DISCOVERY_PAGES, X_PRO_RECON_URLS, GRYPHON_GRAPHQL_OPS, GRAPHQL_URL_TEMPLATE, REST_V1_1_BASE, PREMIUM_GRAPHQL_OPS, PRODUCT_SKUS}` | none | `premium`, `xpro probe` print some | constants | `data`: kept as constants (no logic); the ones that exist in Rust are parity-tested against the native `meta` op |
| `RADAR_*` (`config/radar-surface.ts` (not in repo)), `X_PRO_*`, `GRYPHON_*`, `X_PRO_COLUMN_TIMELINE_OPS` (`config/x-pro-surface.ts` (not in repo)) | `GRYPHON_GRAPHQL_OPS`, `X_PRO_RECON_URLS` | none | none | constants | `data` |

### 2.4 Services

| TS export | (a) Rust | (b) FFI | (c) CLI | (d) TS-only | Decision |
| --- | --- | --- | --- | --- | --- |
| `getNews`, `parsePostCount`, `parseNewsItem`, `parseTabItems`, `NewsItem`, `NewsOptions` (`services/news.ts`, 248 lines) | `get_news`; private `parse_post_count`, `parse_news_item`, `parse_tab_items` | none | `news` | literal port | `drop`; the three parsers become `pub` and pure native ops |
| `fetchPremiumUpsells`, `fetchPremiumBundle`, `parseUpsellsResponse`, `parsePremiumFlags`, types (`services/premium.ts`, 165 lines) | `premium_upsells`, `premium_bundle`, `parse_upsells_response`, `parse_premium_flags`, `PremiumUpsells`, `PremiumAccountFlags`, `UpsellConfigEntry` | none | `premium` | literal port | `drop`; native ops |
| `premiumGraphqlVariables`, `fetchAllPremiumGraphql` | none | none | none | variable templates for 12 operations and the dump loop | `port`: native ops `premium_variables`, `premium_fetch_all` |
| `uploadMedia` | `upload_media` | none | `upload-media` | see 2.1 | `drop` the port |
| `buildCoverageReport`, `resolveOperationQueryId`, `CoverageReport` (`services/coverage.ts`, 67 lines) | `catalog_sync::catalog_stats`, CLI `coverage` | none | `coverage [--probe-premium]` | report assembly | `thin` over native ops `coverage`, `catalog_list`, `query_ids_get` |
| `viewerAccountSync`, `getDeck`, `createDeck`, `updateDeck`, `removeDeck`, `probeXProAccess`, `parseViewerAccountSync`, types (`services/x-pro-deck.ts`, 171 lines) | `viewer_account_sync`, `xpro_get_deck`, `xpro_create_deck`, `xpro_update_deck`, `xpro_remove_deck`, `probe_xpro_access`, `parse_viewer_account_sync` | none | `xpro sync|deck|create|remove|probe` | literal port | `drop`; native ops |
| `reorderDecks`, `createColumn`, `updateColumn`, `removeColumn`, `reorderColumns`, `importClientSyncColumns` | none | none | none | one-line GraphQL calls | `port` as ops over `graphql` (`xpro_reorder_decks`, `xpro_create_column`, ...) |
| `radarSearch`, `radarSearchAll`, `radarMetrics`, `radarExplore`, `probeRadarAccess`, types (`services/radar.ts`, 173 lines) | none (Radar is `SearchTimeline` with `querySource: radar`) | none | none | aggregation (`computeMetrics`, day buckets) and a page loop | `thin`: stays TypeScript orchestration over the native `search` (new `query_source`), `explore` and `graphql` ops; its parser import disappears |
| `startSyncCron`, `SyncOptions` (`services/cron.ts`, 71 lines) | CLI `jobs` prints a scheduler snippet | none | `jobs` | `Bun.cron` schedule and store writes | `thin`: orchestration (scheduling is a Bun capability) |
| `Crawler`, `CrawlerOptions` (`services/crawler.ts`, 337 lines) | none | none | none | breadth-first crawl with visited sets, raw SQL on the store | `thin`: orchestration; raw SQL replaced by native store ops (`store_known_usernames`, `store_known_communities`) and one batched `store_ingest` per step |
| `purgeFollowing`, `captureFollowGraph`, `collectFollowing`, `collectFollowers`, `buildQueue`, `loadState`, `saveState`, `estimateEta`, `sleep`, `RateGovernor`, `WINDOW_MS`, `DAY_MS`, `UNFOLLOW_DEFAULTS`, types (`services/unfollow.ts`, 536 lines) | none (CLI `unfollow` is a single call) | none | none | resumable journal, ordering (non-mutuals first), pacing | `thin`: orchestration, kept with its 734-line test; calls the native client |
| `purge-engine` exports: `runMutationQueue`, `readWithBackoff`, `PACING_DEFAULTS`, `TERMINAL_CODES`, `AUTH_CODES`, `writeJsonPrivate`, `errorCode`, `errorStatus`, `errorMessage`, `isRateLimitError`, `isTerminalError`, types (561 lines) | none | none | none | pacing governor with injected clocks, error taxonomy, mutation loop | `thin` for the loop and the journal writer; the **taxonomy** (`TERMINAL_CODES`, `AUTH_CODES`, rate-limit rule) has one owner, Rust `policy.rs`, shared as data (`crates/web/x/data/x-policy.json`) and consumed by both |
| `purgeTweets`, `captureArchive`, `collectTimeline`, `buildTweetQueue`, `classifyPost`, `retweetIsOwnStatus`, `loadTweetState`, `saveTweetState`, `ARCHIVE_SOURCES`, `TWEET_PURGE_DEFAULTS`, types (`services/purge-tweets.ts`, 662 lines) | none | none | none | classification, least-liked-first queue, journal | `thin`: orchestration, kept with its 868-line test |

### 2.5 Store and archive

| TS export | (a) Rust | (b) FFI | (c) CLI | (d) TS-only | Decision |
| --- | --- | --- | --- | --- | --- |
| `Store`, `edge`, `StoredTweet`, `StoreStats`, `Digest` (`db/store.ts`, 301 lines) | `store::{Store, edge, StoredTweet, Stats, Digest}` (same SQL, same schema, same file `~/.aphrody/x-store.sqlite`) | none | `db stats|search|export|digest`, `graph`, `sync` | verbatim duplicate | `drop` the port; thin `Store` class over native store ops (a store handle lives in Rust); the public `db` field disappears (read-only SQL goes through `store_query`) |
| `importArchive`, `resolveTweetsFile`, `parseArchiveArray`, `archiveTweetToTweet` (`db/archive.ts`, 121 lines) | `archive::import_archive` (helpers private) | none | `import archive` | duplicate | `drop`; helpers made `pub`, native ops `import_archive`, `archive_resolve_file`, `archive_parse`, `archive_tweet` |
| `findAndUpsertUsers` (`db/ingest.ts`, 36 lines; not in the index, used by the crawler and a test) | none | none | none | recursive user harvest | `port` as a native op `store_ingest_users { store, json }` (walks `user_results`, upserts) |

### 2.6 Tools, ranking, recon

| TS export | (a) Rust | (b) FFI | (c) CLI | (d) TS-only | Decision |
| --- | --- | --- | --- | --- | --- |
| `XTools`, `X_TOOL_NAMES`, `isXToolName`, `xSearchToolDef`, `xProfileToolDef`, `xWhoamiToolDef`, `xTweetsToolDef`, `xNewsToolDef`, `xNativeTools`, types (`packages/web/x/src/tools/function-tools.ts`, 243 lines) | MCP tool `aphrody_x_client` (`crates/ai/mcp/src/x_tools.rs`) serves the same five actions to MCP hosts | none | none | OpenAI function schemas and argument validation | `thin`: stays (the schemas and the validation are TypeScript-side contracts of `@aphrody/xai`); fulfils calls with the native client |
| `rankPosts`, `rankPostsNative`, `rankTweets`, `rankTweetsNative`, `toPostCandidate`, `tweetToPostCandidate`, types (`algo.ts`, 168 lines) | `algorithm::{rank_posts, rank_posts_json}`, `tweet_to_algo_candidate`, `rank_tweets` | `aphrody_web_x_algorithm_rank` | none | `tweetToPostCandidate` duplicates `tweet_to_algo_candidate` (and parses `created_at` correctly, which the Rust one does not: X dates are not RFC 2822) | `port` the timestamp fix and `has_media` to Rust; `rankTweets` calls the native `rank_tweets`; `toPostCandidate` (raw multi-shape adapter) stays as a typed TS adapter |
| `runXWebRecon`, `XSurfaceReconReport`, `ReconSummary`, `WebReconProfile` (`packages/web/x/src/tools/web-recon.ts`, 103 lines) | none (web recon owner: `aphrody-web`) | `aphrody_web_obscura_fetch_submit` | `aphrody web` | profile routing; rendered profiles spawn the `aphrody-web` binary | `thin`, out of the X-client domain; left as is (open item: the rendered profiles still spawn a subprocess) |

## 3. Consumers

| Consumer | Uses | Action |
| --- | --- | --- |
| `packages/ai/xai/src/core/client.ts` (not in repo), `src/agent.ts`, `src/index.ts` | `XTools`, `xNativeTools`, the five `*ToolDef`, the tool argument types | historical result; SDK TypeScript removed 2026-10-09 |
| `packages/ai/xai/examples/grok-x-agent.ts` (not in repo) | `XSession.loadOrEnv()`, `XTools` | historical result; removed 2026-10-09 |
| `packages/ai/xai/index.test.ts` (not in repo) (line 245) | dynamic `import("@aphrody/x")` | historical result; removed 2026-10-09 |
| `packages/ai/xai/package.json` (not in repo), `README.md` | dependency `@aphrody/x` (`workspace:*`), prose on the TypeScript client | historical result; removed 2026-10-09 |
| `scripts/tools/web/x-catalog-sync.ts` | `syncCatalogFromBundles`, `DEFAULT_CATALOG_PATH` | calls the native `catalog_sync`; path from the shared constant |
| `scripts/tools/web/x-coverage.ts` | `XClient`, `XSession`, `buildCoverageReport` | unchanged call shape |
| `scripts/tools/web/x-premium-dump.ts` | `XClient`, `XSession`, `DEFAULT_CATALOG_PATH`, `client.graphqlWaiting`, `client.whoami`, `client.session` | unchanged call shape; catalog path from the shared constant |
| `packages/infra/workspace/test/aphrody-packages.test.ts`, `ecosystem-deps.test.ts`, `web-migration.test.ts`; `packages/infra/update/test/bun.test.ts`, `deps.test.ts` | the package name and version strings only | no behaviour dependency; checked unchanged |
| `package.json` (root) `ai:lint`, `ai:fmt` | path `packages/web/x/` | unchanged |
| `tools/config/pipeline.json`, `tools/config/stack-training.json` | package names | unchanged |
| Rust: `crates/infra/aphrody-command` (`multicall.rs`, `pillars_cmd/web.rs`), `crates/ai/mcp/src/x_tools.rs` | `XClient`, `XSession`, `NewsOptions`, `cli_main`, `algorithm` | Rust API kept source-compatible (`XSession`, `XClient::new`, existing methods) |

## 4. What is Rust-owned once the batches land

Everything under `XClient`, `core/*`, `config/{catalog,query-ids}`, `db/*`, `services/{media,news,premium,x-pro-deck,coverage}`
and `tools/bundle-catalog` (not in repo) has a single implementation in `aphrody-x`, reached through one versioned JSON job API. What
stays in TypeScript is orchestration and contracts: purge engine, unfollow, tweet purge, radar, cron, crawler, function
tools, recon, the session value object, constants and types.

## 5. Decisions recorded (`tranché`)

| # | Decision |
| --- | --- |
| D1 | One native job API for X (`op` name plus JSON arguments, JSON envelope result) instead of one export per operation. The five existing `aphrody_web_x_*` exports stay as compatibility aliases. |
| D2 | Credentials cross the FFI once, when a client handle is opened; cookies are never logged and never part of a fixture. |
| D3 | Batches (bounded concurrency, per-operation error isolation, retry and rate-limit waiting, JSONL checkpoint and resume) run inside Rust; TypeScript only submits and drains results. |
| D4 | Retries apply to idempotent operations only; creating a post, a DM or a deck is never retried after an ambiguous failure unless the caller opts in. |
| D5 | Rate limits are tracked per endpoint (operation name), not as one global "last" value, because a batch mixes endpoints. |
| D6 | The error taxonomy has one owner (Rust) and is shared as data with the TypeScript purge engine. |
| D7 | The TypeScript `XSession` stays a value object (constructible without the native library); discovery is native when no session is given. |
| D8 | The catalog, Gryphon catalog and surface data stay single JSON files read by both languages; no table is copied. |
| D9 | The purge, unfollow, radar, cron and crawler services stay TypeScript orchestration over the native client; their journals and pacing tests are kept. |
| D10 | `Tweet.media`, `user_tweets_and_replies`, `user_media`, cookie rotation, 414 fallback and the X timestamp parser are ported to Rust (they existed only in TypeScript, or were wrong in Rust). |
