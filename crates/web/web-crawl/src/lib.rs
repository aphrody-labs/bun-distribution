// SPDX-License-Identifier: Apache-2.0
//! Shared crawl frontier, page processing and injectable network transport.

mod blocking;
mod frontier;
mod mediawiki;
mod mirror;
mod revisit;
mod robots;
mod runner;
mod scoring;
mod sitemap;
pub mod wiki;

pub use blocking::BlockingCrawler;
pub use frontier::{AddRequest, Frontier, FrontierOptions, FrontierStats, Lease, RequestState};
pub use mediawiki::{MediaWikiDocument, MediaWikiError, MediaWikiOptions, crawl_mediawiki};
pub use mirror::{
    MirrorError, MirrorFailure, MirrorFile, MirrorOptions, MirrorReport, mirror_site,
};
pub use revisit::{
    ChangeHistory, RevisitPolicy, estimate_change_rate, revisit_interval_ms, revisit_priority,
};
pub use robots::RobotsFile;
pub use runner::{
    CrawlDaemonOptions, CrawlOptions, CrawlPage, CrawlReport, CrawlTransport, FetchResult,
    ObscuraTransport, crawl_bounded, crawl_daemon, extract_links_opts,
};
pub use scoring::{anchor_relevance, frontier_score};
pub use sitemap::{ParsedSitemap, SitemapEntry, SitemapKind, parse_sitemap, seed_boost};
