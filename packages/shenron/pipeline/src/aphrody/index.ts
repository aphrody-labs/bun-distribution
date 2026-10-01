// SPDX-License-Identifier: Apache-2.0
/**
 * @shenron/pipeline/aphrody — clients for the Aphrody Rust services.
 *
 * Network clients use compute, Shenron E5 embeddings and the web crawler.
 * Script adapters execute the Aphrody CLI and require Bun when invoked.
 * Importing this entry point does not load `bun:ffi`, `bun:sqlite` or `sharp`.
 * The A2A hub lives at `@shenron/pipeline/aphrody/a2a`.
 */

export {
  AphrodyComputeClient,
  type AphrodyChatMessage,
  type AphrodyComputeOptions,
  type AphrodyRagDocument,
  type AphrodyRagHit,
  type AphrodyRagMode,
  type AphrodyRagStats,
  type AphrodyRagStoredDocument,
} from "./compute";
export {
  SHENRON_EMBED_DIMENSIONS,
  SHENRON_EMBED_MODEL,
  ShenronEmbeddingsClient,
  type ShenronEmbedKind,
  type ShenronEmbeddingsOptions,
} from "./shenron-embeddings";
export {
  aphrodyWebRecon,
  aphrodyWebCrawl,
  aphrodyWebSearch,
  aphrodyWebScrape,
  scrapeWithAphrody,
  type AphrodyScrapeOptions,
  type AphrodyScrapeProfile,
  type AphrodyScrapeResult,
  type AphrodyWebScrapeOptions,
  type AphrodyWebCrawlRequest,
  type AphrodyWebCrawlReport,
  AphrodyWebClient,
  type AphrodyCrawlJob,
  type AphrodyCrawlOptions,
  type AphrodyCrawlRequest,
} from "./web";
export {
  aphrodyInfraCheck,
  aphrodyInfraStatus,
  type AphrodyInfraCheck,
  type AphrodyInfraTargetCheck,
} from "./infra";
export {
  AphrodyTranslateService,
  TranslateOptionsSchema,
  TranslationResultSchema,
  type TranslateOptions,
  type TranslationResult,
} from "./translate";

export {
  AphrodyWikiSearchService,
  WikiSearchResultSchema,
  resolveWikiApiUrl,
  type AphrodyWikiOptions,
  type WikiSearchResult,
} from "./wiki";
export {
  aphrodyWebMirror,
  type AphrodyWebMirrorFailure,
  type AphrodyWebMirrorReport,
  type AphrodyWebMirrorRequest,
} from "./mirror";
