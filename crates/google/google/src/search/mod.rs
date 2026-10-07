// SPDX-License-Identifier: Apache-2.0
//! Shared native Google Search API.

mod discovery;
mod network;
mod serp;

pub use discovery::{
    GoogleVertical, autocomplete, parse_vertical, resolve_dns, search_books, search_vertical,
};

pub use network::{
    RichSearchResult, SearchOptions, SearchTransport, is_blocked_serp_html, is_google_domain,
    search_rich, search_url,
};
pub use serp::{FeaturedSnippet, KnowledgePanel, OrganicResult, SerpContent, parse_serp};
