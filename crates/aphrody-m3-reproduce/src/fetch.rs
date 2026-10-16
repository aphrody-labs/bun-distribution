// SPDX-License-Identifier: Apache-2.0
//! Fetches a URL's HTML, then hands it to [`crate::crawl`]. `network` feature.
//!
//! Uses `reqwest`'s blocking client directly rather than adding a browser dependency: the goal is
//! reproducing a page's declared theme, fonts and layout, which live in markup and CSS the server
//! sends, not in JavaScript-rendered DOM state. Sites that build their entire UI client-side will
//! need a rendered capture (`--image` on a screenshot) instead.
//!
//! Native targets only: `reqwest::blocking` does not exist on `wasm32`, where the host must fetch
//! the HTML itself and pass it to [`crate::ReproductionPlan::from_html`].

use crate::plan::ReproductionSource;

const USER_AGENT: &str = concat!("aphrody-m3-reproduce/", env!("CARGO_PKG_VERSION"));

/// Fetches `url`'s HTML with a short timeout and a descriptive user agent.
///
/// # Errors
///
/// Returns [`crate::Error::Fetch`] on a network, TLS, redirect-limit or non-success-status error.
pub fn fetch_html(url: &str) -> crate::Result<String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let response = client.get(url).send()?.error_for_status()?;
    Ok(response.text()?)
}

/// Fetches `url` and builds a [`crate::ReproductionPlan`] from it (see
/// [`crate::plan::ReproductionPlan::from_html`]).
///
/// # Errors
///
/// Returns [`crate::Error::Fetch`] if [`fetch_html`] fails.
pub fn plan_from_url(url: &str) -> crate::Result<crate::ReproductionPlan> {
    let html = fetch_html(url)?;
    Ok(crate::ReproductionPlan::from_html(&html, ReproductionSource::Url { url: url.to_owned() }))
}
