// SPDX-License-Identifier: Apache-2.0

export { XSession, type XSessionData, type XSessionWire } from "./core/session";
export { API_BASE } from "./core/client";
export {
  XClient,
  type XClientOptions,
  type XClientCallOptions,
  type XClientSession,
  type XClientSessionInput,
  type XSearchOptions,
  type RateLimit,
  type TweetResult,
  type UserInfo,
  type ListInfo,
  type TimelineTweet,
} from "./core/client";
// Mass scripting: bounded concurrency, retry, rate-limit waiting, pacing and checkpoint in Rust.
export {
  XBatch,
  xBatch,
  xLocal,
  type XBatchOpInput,
  type XBatchOptions,
  type XBatchProgress,
  type XBatchResult,
  type XBatchRunOptions,
  type XBatchRunSummary,
  type XBatchSummary,
  type XEnvelope,
} from "./batch";
export { type XErrorKind } from "./core/error";
export { QueryIdStore, type QueryIdSnapshot } from "./config/query-ids";
export {
  XError,
  checkApiErrors,
  walkTimelineTweets,
  walkTimelineUsers,
  parseSingleTweet,
  parseTweetResult,
  parseUserResult,
  type Author,
  type Media,
  type Tweet,
  type TweetPage,
  type User,
  type UserPage,
} from "./core/parse";
export { getNews, parsePostCount, parseNewsItem, parseTabItems, type NewsItem, type NewsOptions } from "./services/news";
export {
  X_DISCOVERY_PAGES,
  X_DISCOVERY_UA,
  X_RECON_URLS,
  X_SDK_COVERAGE,
  X_REST_V1_1,
  X_CDN,
  PREMIUM_ROUTES,
  PREMIUM_GRAPHQL_OPS,
  PREMIUM_PRODUCT_SKUS,
  PREMIUM_PAGE_URL,
  PREMIUM_PAYMENT_HOSTS,
  X_API_ENDPOINTS,
} from "./config/x-surface";
export {
  syncCatalogFromBundles,
  fetchLiveQueryIds,
  discoverBundleUrls,
  extractAllOperationsFromJs,
} from "./tools/bundle-catalog";
export { runXWebRecon, type XSurfaceReconReport, type ReconSummary, type WebReconProfile } from "./tools/web-recon";
// X as OpenAI-compatible function tools for model tool-calling loops (Grok, local models).
export {
  XTools,
  X_TOOL_NAMES,
  isXToolName,
  xSearchToolDef,
  xProfileToolDef,
  xWhoamiToolDef,
  xTweetsToolDef,
  xNewsToolDef,
  xNativeTools,
  type XToolName,
  type XToolsClient,
  type XSearchToolArgs,
  type XProfileToolArgs,
  type XTweetsToolArgs,
  type XNewsToolArgs,
} from "./tools/function-tools";
export { buildCoverageReport, resolveOperationQueryId, type CoverageReport } from "./services/coverage";
export {
  fetchPremiumUpsells,
  fetchPremiumBundle,
  fetchAllPremiumGraphql,
  premiumGraphqlVariables,
  parseUpsellsResponse,
  parsePremiumFlags,
  type PremiumUpsells,
  type PremiumAccountFlags,
  type UpsellConfigEntry,
  type UpsellSurfaceKey,
  type ProductCategory,
  type ChargeInterval,
} from "./services/premium";
export {
  RADAR_PAGE_URL,
  RADAR_NEW_URL,
  RADAR_ROUTES,
  RADAR_GRAPHQL_OPS,
  RADAR_QUERY_SOURCE,
  RADAR_SEARCH_PRODUCTS,
  RADAR_QUERY_SYNTAX_HELP,
  type RadarSearchProduct,
} from "./config/radar-surface";
export {
  X_PRO_HOST,
  X_PRO_DECKS_NEW,
  X_PRO_DECKS_MANAGE,
  X_PRO_DECK_URL,
  GRYPHON_BUNDLE_BASE,
  X_PRO_ROUTES,
  GRYPHON_GRAPHQL_OPS,
  X_PRO_COLUMN_TIMELINE_OPS,
  X_PRO_RECON_URLS,
} from "./config/x-pro-surface";
export {
  viewerAccountSync,
  getDeck,
  createDeck,
  updateDeck,
  removeDeck,
  reorderDecks,
  createColumn,
  updateColumn,
  removeColumn,
  reorderColumns,
  importClientSyncColumns,
  probeXProAccess,
  parseViewerAccountSync,
  type XProDeck,
  type XProDeckColumn,
  type XProDeckConfig,
  type XProAccountSync,
  type ViewerAccountSyncResult,
} from "./services/x-pro-deck";
export {
  radarSearch,
  radarSearchAll,
  radarMetrics,
  radarExplore,
  probeRadarAccess,
  type RadarSearchOptions,
  type RadarMetrics,
  type RadarActivityBucket,
  type RadarExploreSnapshot,
} from "./services/radar";
export { uploadMedia } from "./services/media";
export { getOperation, allOperations, queries, mutations, type Operation } from "./config/catalog";
export { Store, edge, type StoredTweet, type Stats as StoreStats, type Digest } from "./db/store";
export { importArchive, resolveTweetsFile, parseArchiveArray, archiveTweetToTweet } from "./db/archive";
export { startSyncCron, type SyncOptions } from "./services/cron";
export { AuthorSchema, TweetSchema, UserSchema, ListInfoSchema } from "./core/schemas";
export { Crawler, type CrawlerOptions } from "./services/crawler";
export {
  purgeFollowing,
  isAuthFailure,
  captureFollowGraph,
  collectFollowing,
  collectFollowers,
  buildQueue,
  loadState,
  saveState,
  estimateEta,
  sleep,
  RateGovernor,
  WINDOW_MS,
  DAY_MS,
  DEFAULTS as UNFOLLOW_DEFAULTS,
  type UnfollowTarget,
  type TargetStatus,
  type TargetRecord,
  type CollectResult,
  type FollowGraph,
  type PurgeState,
  type PurgeOptions,
  type PurgeProgress,
  type PurgeReport,
} from "./services/unfollow";
export {
  runMutationQueue,
  readWithBackoff,
  PACING_DEFAULTS,
  TERMINAL_CODES,
  AUTH_CODES,
  writeJsonPrivate,
  errorCode,
  errorStatus,
  errorMessage,
  isRateLimitError,
  isTerminalError,
  type PacingOptions,
  type MutationStatus,
  type MutationOutcome,
  type StopReason,
  type RunQueueDeps,
  type RunQueueResult,
  type ReadRetryDeps,
} from "./services/purge-engine";
export {
  purgeTweets,
  captureArchive,
  collectTimeline,
  buildTweetQueue,
  classifyPost,
  retweetIsOwnStatus,
  loadTweetState,
  saveTweetState,
  ARCHIVE_SOURCES,
  TWEET_PURGE_DEFAULTS,
  type PostKind,
  type TweetTarget,
  type TweetTargetStatus,
  type TweetRecord,
  type SourceResult,
  type ArchiveSource,
  type ArchiveSnapshot,
  type TweetPurgeState,
  type PurgeTweetsOptions,
  type TweetPurgeProgress,
  type TweetPurgeReport,
} from "./services/purge-tweets";

// X For You style local ranking (native port of xai-org/x-algorithm concepts).
// Mirrors the Rust integration in rust-bridge/crates/x-client.
// Use `rankTweets(tweetsFromClient, context)` for typed results from XClient.
// See also the Rust FFI `aphrody_web_x_algorithm_rank` and `x_client::rank_tweets`.
export {
  rankPosts,
  rankPostsNative,
  rankTweets,
  rankTweetsNative,
  toPostCandidate,
  tweetToPostCandidate,
  type PostCandidate,
  type RankingContext,
  type ScoredPost,
} from "./algo";
