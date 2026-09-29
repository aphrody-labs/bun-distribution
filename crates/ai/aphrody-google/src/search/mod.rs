// SPDX-License-Identifier: Apache-2.0
//! Shared native Google Search API.

mod network;
mod serp;

pub use network::{
    RichSearchResult, SearchOptions, SearchTransport, is_blocked_serp_html, search_rich, search_url,
};
pub use serp::{FeaturedSnippet, KnowledgePanel, OrganicResult, SerpContent, parse_serp};
