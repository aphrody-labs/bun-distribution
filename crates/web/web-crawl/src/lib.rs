// SPDX-License-Identifier: Apache-2.0
//! Shared crawl frontier, page processing and injectable network transport.

mod frontier;
mod mediawiki;
mod revisit;
mod robots;
mod runner;
mod scoring;
mod sitemap;

pub use frontier::{AddRequest, Frontier, FrontierOptions, FrontierStats, Lease, RequestState};
pub use mediawiki::{crawl_mediawiki, MediaWikiDocument, MediaWikiError, MediaWikiOptions};
pub use revisit::{
    ChangeHistory, RevisitPolicy, estimate_change_rate, revisit_interval_ms, revisit_priority,
};
pub use robots::RobotsFile;
pub use runner::{
    CrawlOptions, CrawlPage, CrawlReport, CrawlTransport, FetchResult, ObscuraTransport,
    crawl_bounded,
};
pub use scoring::{anchor_relevance, frontier_score};
pub use sitemap::{ParsedSitemap, SitemapEntry, SitemapKind, parse_sitemap, seed_boost};
