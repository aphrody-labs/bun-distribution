// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Native compatibility surface backed by the shared Rust Web crates.

use std::{marker::PhantomData, path::Path, sync::OnceLock};

use crate::{
    error::{Result, WebBrowserError},
    resolve::Source,
};

/// The parsed DOM is owned by the shared Obscura implementation.
pub type DomTree = obscura_dom::DomTree;

/// Compatibility facade for the former dynamically loaded Web bridge.
#[derive(Debug)]
pub struct Bridge {
    source: Source,
}

/// Remove interior NUL bytes from imported text and report the number removed.
#[must_use]
pub fn scrub_nuls(input: &str) -> (String, usize) {
    if !input.as_bytes().contains(&0) {
        return (input.to_owned(), 0);
    }
    let cleaned: String = input.chars().filter(|c| *c != '\0').collect();
    let dropped = input.len() - cleaned.len();
    (cleaned, dropped)
}

impl Bridge {
    /// Use the Rust Web implementation linked into the current process.
    ///
    /// # Errors
    /// Returns `LibraryUnavailable` if the current executable path cannot be read.
    pub fn load() -> Result<Self> {
        let path = std::env::current_exe()
            .map_err(|error| WebBrowserError::LibraryUnavailable { detail: error.to_string() })?;
        Ok(Self { source: Source::InTree(path) })
    }

    /// Create a compatibility facade with an explicit provenance path.
    ///
    /// # Errors
    /// Returns `OverrideMissing` when the named path does not exist.
    pub fn load_from(source: Source) -> Result<Self> {
        if !source.path().is_file() {
            return Err(WebBrowserError::OverrideMissing {
                var: "bridge source",
                path: source.path().to_path_buf(),
            });
        }
        Ok(Self { source })
    }

    /// The provenance path associated with this facade.
    #[must_use]
    pub const fn source(&self) -> &Source {
        &self.source
    }

    /// The provenance path associated with this facade.
    #[must_use]
    pub fn path(&self) -> &Path {
        self.source.path()
    }

    /// Convert HTML to Markdown through the shared Rust extractor.
    ///
    /// # Errors
    /// This local conversion has no recoverable error.
    pub fn html_to_markdown(&self, html: &str) -> Result<String> {
        let (clean, dropped) = scrub_nuls(html);
        if dropped > 0 {
            tracing::debug!(dropped, "stripped NUL bytes before Markdown conversion");
        }
        Ok(aphrody_web_extract::html_to_markdown(&clean, None))
    }

    /// Extract the first title element, returning an empty string when absent.
    ///
    /// # Errors
    /// This local parse has no recoverable error.
    pub fn extract_title(&self, html: &str) -> Result<String> {
        let (clean, _) = scrub_nuls(html);
        let tree = obscura_dom::parse_html(&clean);
        let title = tree.query_selector("title").ok().flatten();
        Ok(title.map_or_else(String::new, |node| tree.text_content(node)))
    }

    /// Return the document text without HTML tags.
    ///
    /// # Errors
    /// This local parse has no recoverable error.
    pub fn strip_tags(&self, html: &str) -> Result<String> {
        let (clean, _) = scrub_nuls(html);
        let tree = obscura_dom::parse_html(&clean);
        Ok(tree.text_content(tree.document()))
    }

    /// Parse HTML into an owned Rust DOM.
    ///
    /// # Errors
    /// This local parse has no recoverable error.
    pub fn parse_html(&self, html: &str) -> Result<Dom<'_>> {
        let (clean, dropped) = scrub_nuls(html);
        if dropped > 0 {
            tracing::debug!(dropped, "stripped NUL bytes before DOM parse");
        }
        Ok(Dom { tree: obscura_dom::parse_html(&clean), bridge: PhantomData })
    }

    /// Run DNS reconnaissance and return a JSON array.
    ///
    /// The synchronous compatibility method uses a separate worker so it can
    /// be called from a Tokio runtime without nesting runtimes.
    ///
    /// # Errors
    /// Returns a browser error if the worker or network operation fails.
    pub fn dns_recon(&self, domain: &str) -> Result<String> {
        let domain = domain.to_owned();
        let worker_domain = domain.clone();
        let result = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| error.to_string())?;
            runtime
                .block_on(obscura_net::DnsRecon::new().run_osint(&worker_domain))
                .map_err(|error| error.to_string())
        })
        .join()
        .map_err(|_| WebBrowserError::Browser {
            url: domain.clone(),
            detail: "DNS worker panicked".to_owned(),
        })?
        .map_err(|detail| WebBrowserError::Browser { url: domain.clone(), detail })?;
        serde_json::to_string(&result)
            .map_err(|error| WebBrowserError::Browser { url: domain, detail: error.to_string() })
    }
}

/// Owned parsed document with a compatibility lifetime tied to its bridge.
pub struct Dom<'b> {
    tree: DomTree,
    bridge: PhantomData<&'b Bridge>,
}

impl core::fmt::Debug for Dom<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Dom").field("nodes", &self.tree.len()).finish_non_exhaustive()
    }
}

impl Dom<'_> {
    /// Outer HTML of the first matching element.
    ///
    /// # Errors
    /// Returns a selector error when the selector is invalid.
    pub fn query_selector(&self, selector: &str) -> Result<Option<String>> {
        self.tree
            .query_selector(selector)
            .map(|node| node.map(|id| self.tree.outer_html(id)))
            .map_err(|detail| WebBrowserError::Selector { selector: selector.to_owned(), detail })
    }

    /// Outer HTML of all matching elements.
    ///
    /// # Errors
    /// Returns a selector error when the selector is invalid.
    pub fn query_selector_all(&self, selector: &str) -> Result<Vec<String>> {
        self.tree
            .query_selector_all(selector)
            .map(|nodes| nodes.into_iter().map(|id| self.tree.outer_html(id)).collect())
            .map_err(|detail| WebBrowserError::Selector { selector: selector.to_owned(), detail })
    }
}

/// Process-wide shared Rust bridge.
///
/// # Errors
/// Returns `LibraryUnavailable` if the current executable path cannot be read.
pub fn shared() -> Result<&'static Bridge> {
    static BRIDGE: OnceLock<Bridge> = OnceLock::new();
    if let Some(bridge) = BRIDGE.get() {
        return Ok(bridge);
    }
    let bridge = Bridge::load()?;
    Ok(BRIDGE.get_or_init(|| bridge))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_conversion_and_dom() {
        let bridge = shared().unwrap();
        let html = "<html><head><title>Example</title></head><body><ul><li class='x'>one</li><li class='x'>two</li></ul></body></html>";
        assert_eq!(bridge.extract_title(html).unwrap(), "Example");
        assert!(bridge.strip_tags(html).unwrap().contains("one"));
        assert!(bridge.html_to_markdown(html).unwrap().contains("one"));
        let dom = bridge.parse_html(html).unwrap();
        assert_eq!(dom.query_selector_all("li.x").unwrap().len(), 2);
        assert!(dom.query_selector("!!!bad((").is_err());
    }

    #[test]
    fn scrubbing_removes_nuls() {
        assert_eq!(scrub_nuls("a\0b"), ("ab".to_owned(), 1));
    }
}
