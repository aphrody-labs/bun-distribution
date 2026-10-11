// SPDX-License-Identifier: Apache-2.0
//! Shared native Google Search API.

mod discovery;
mod network;
mod request;
mod serp;

pub use discovery::{
    GoogleVertical, autocomplete, parse_vertical, resolve_dns, search_books, search_vertical,
};

pub use network::{
    RichSearchResult, SearchOptions, SearchTransport, is_blocked_serp_html, is_google_domain,
    search_rich, search_url,
};
pub use request::{
    execute_search_request, parse_search_request, project_search_result, project_vertical_result,
};
pub use serp::{FeaturedSnippet, KnowledgePanel, OrganicResult, SerpContent, parse_serp};
