// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Fetching a page and turning it into Markdown, without a third party.
//!
//! # What this replaces
//!
//! The MCP tools `universal_web_fetch` and `coding_style_guide` used to answer every call with
//! `reqwest::get(format!("https://r.jina.ai/{url}"))`. That single line meant: a third-party
//! reader saw the URL, the source IP and the timing of every page the model read; there was no
//! timeout, no user agent, no size cap; and the HTTP status was never inspected, so a `402` or
//! `429` from the proxy was handed to the model as though it were the page. The repository is
//! local-first; routing every read through a rented reader is the opposite of that.
//!
//! # The network decision, stated on purpose
//!
//! Reading a web page needs the network. What it does **not** need is a second remote party. So
//! the default path here is:
//!
//! 1. aphrody fetches the bytes itself, over its own rustls client, with a timeout, a real user
//!    agent, a size cap and a status check;
//! 2. the bytes are converted to Markdown in this process by the canonical `aphrody-web-extract`
//!    Rust crate.
//!
//! The only host contacted is the origin the caller asked for. No proxy, no reader service, no
//! API key, nothing to rate-limit us.
//!
//! Browser profiles render JavaScript through the in-process Obscura runtime. They are selected
//! explicitly because they consume more resources.
//!
//! # Nothing degrades in silence
//!
//! An empty Markdown result from nonempty HTML returns the original HTML with
//! [`Rendering::RawHtml`] and a reason. [`Fetched::path_taken`] records the actual Rust
//! converter, while the serialized `via` marker remains stable.

use std::{sync::OnceLock, time::Duration};

use crate::error::{Result, WebError};

/// A fetch profile.
///
/// `static` and `http` use the in-process HTTP client; `fast`, `stealth` and `max` render the
/// page in the in-process Obscura browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    /// Plain HTTP, no browser.
    Static,
    /// Fast browser path.
    Fast,
    /// HTTP with header shaping.
    Http,
    /// Anti-bot evasion (requires the `stealth` feature).
    Stealth,
    /// Everything the engine can bring to bear (requires the `stealth` feature).
    Max,
}

impl Profile {
    /// The spelling used on command lines and in tool schemas.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Fast => "fast",
            Self::Http => "http",
            Self::Stealth => "stealth",
            Self::Max => "max",
        }
    }

    /// Parse a profile name, case-insensitively.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "static" => Some(Self::Static),
            "fast" => Some(Self::Fast),
            "http" => Some(Self::Http),
            "stealth" => Some(Self::Stealth),
            "max" => Some(Self::Max),
            _ => None,
        }
    }

    /// Whether this profile drives the in-process browser.
    #[must_use]
    pub const fn needs_browser(self) -> bool {
        matches!(self, Self::Fast | Self::Stealth | Self::Max)
    }
}

/// Default per-request timeout.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Default cap on the bytes read from an origin (2 MiB).
///
/// Generous for documentation, small enough that a mis-typed URL pointing at a disk image cannot
/// exhaust memory.
pub const DEFAULT_MAX_BYTES: usize = 2 * 1024 * 1024;

/// User agent used for direct fetches and by the crawler.
///
/// A realistic browser string: a CLI-shaped agent is refused by a large share of documentation
/// hosts, and a refusal that arrives as an empty page is worse than a slow one.
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                              (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

/// How the bytes were obtained.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum Transport {
    /// aphrody fetched them directly from the origin.
    Direct {
        /// Final URL after redirects.
        final_url: String,
        /// HTTP status.
        status: u16,
    },
    /// The in-process Obscura browser loaded the page.
    Browser {
        /// The profile requested.
        profile: Profile,
        /// Final URL after navigation.
        final_url: String,
    },
}

/// How the bytes became the body that is returned.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum Rendering {
    /// Converted to Markdown.
    Markdown {
        /// Which component did the conversion.
        via: String,
    },
    /// Returned verbatim because the response was not HTML.
    Verbatim {
        /// The content type that made this the right answer.
        content_type: String,
    },
    /// HTML, **unconverted**, because conversion produced no usable content.
    ///
    /// This variant exists so that a degraded answer is legible as degraded: handing back HTML
    /// that merely looks like a bad conversion is the failure this module was written to remove.
    RawHtml {
        /// Why the conversion did not happen, including the fix.
        reason: String,
    },
}

/// A completed fetch, with its itinerary attached.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Fetched {
    /// The URL that was requested.
    pub url: String,
    /// How the bytes arrived.
    pub transport: Transport,
    /// How they were rendered.
    pub rendering: Rendering,
    /// The body.
    pub body: String,
    /// Bytes received before any truncation.
    pub bytes_in: usize,
    /// Whether the body was cut at the size cap.
    pub truncated: bool,
    /// Human-readable trail: every step that actually ran, in order.
    pub path_taken: Vec<String>,
}

impl Fetched {
    /// A one-line provenance banner suitable for prefixing an MCP answer.
    ///
    /// Tools return a `String` to the model, and a model that cannot tell a converted page from
    /// raw HTML will happily quote a `<div>` back at the user. The banner makes the difference
    /// visible in the one place the model actually reads.
    #[must_use]
    pub fn banner(&self) -> String {
        let mut line = format!("Source: {}", self.url);
        line.push_str(&format!("\nPath: {}", self.path_taken.join(" -> ")));
        if self.truncated {
            line.push_str(&format!(
                "\nTruncated at {} bytes of {}.",
                self.body.len(),
                self.bytes_in
            ));
        }
        if let Rendering::RawHtml { reason } = &self.rendering {
            line.push_str(&format!("\nNOTE: raw HTML, not Markdown. {reason}"));
        }
        line
    }

    /// The banner followed by a blank line and the body.
    #[must_use]
    pub fn to_report(&self) -> String {
        format!("{}\n\n{}", self.banner(), self.body)
    }
}

/// A fetch request.
#[derive(Debug, Clone)]
pub struct Request {
    /// The URL to read.
    pub url: String,
    /// Select an HTTP or in-process browser profile.
    pub profile: Option<Profile>,
    /// Per-request timeout.
    pub timeout: Duration,
    /// Cap on the returned body.
    pub max_bytes: usize,
    /// Permit browser navigation to loopback or private network addresses.
    pub allow_private_network: bool,
}

impl Request {
    /// A direct fetch with the defaults.
    #[must_use]
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            profile: None,
            timeout: DEFAULT_TIMEOUT,
            max_bytes: DEFAULT_MAX_BYTES,
            allow_private_network: false,
        }
    }

    /// Select a profile while retaining the same request budget.
    #[must_use]
    pub fn with_profile(mut self, profile: Profile) -> Self {
        self.profile = Some(profile);
        self
    }

    /// Override the request budget on HTTP and browser paths.
    #[must_use]
    pub const fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Override the size cap.
    #[must_use]
    pub const fn with_max_bytes(mut self, max_bytes: usize) -> Self {
        self.max_bytes = max_bytes;
        self
    }

    /// Permit an explicit browser fetch of a local or private service.
    #[must_use]
    pub const fn with_private_network(mut self, allow: bool) -> Self {
        self.allow_private_network = allow;
        self
    }
}

/// Shared HTTP client for the direct path.
///
/// One TLS stack and one connection pool per process. Built lazily so a process that never
/// fetches never pays for it, and so the rustls provider only has to be installed before the
/// *first* fetch rather than before startup.
fn client() -> Result<&'static reqwest::Client> {
    static CLIENT: OnceLock<core::result::Result<reqwest::Client, String>> = OnceLock::new();
    match CLIENT.get_or_init(|| {
        // The workspace pins reqwest to `rustls-no-provider`, so rustls 0.23 has no default
        // crypto provider until somebody installs one, and it does not fail politely: the first
        // request panics with "No provider set", inside reqwest, at send time. A library must
        // not take an MCP server down because a caller forgot; installing here is idempotent
        // (`install_default` returns `Err` when a provider is already set, which is the no-op
        // we want), so the result is deliberately discarded.
        let _ = rustls::crypto::ring::default_provider().install_default();

        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            // 10 redirects is the reqwest default; documentation hosts chain a few
            // (http -> https -> canonical locale), so keep it.
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| {
                format!(
                    "HTTP client could not be built: {e}\nThe workspace pins reqwest to \
                     `rustls-no-provider`, so a crypto provider must be installed once at \
                     startup: `rustls::crypto::ring::default_provider().install_default()`."
                )
            })
    }) {
        Ok(c) => Ok(c),
        Err(detail) => {
            Err(WebError::Http { url: "<client init>".to_owned(), source: detail.clone().into() })
        },
    }
}

/// Whether a content type denotes HTML.
#[must_use]
pub fn is_html(content_type: &str) -> bool {
    let lower = content_type.to_ascii_lowercase();
    lower.contains("text/html") || lower.contains("application/xhtml")
}

/// Cut a string to at most `max_bytes`, on a character boundary.
///
/// Returns the text and whether anything was removed: the caller reports the truncation rather
/// than handing back a silently shortened document.
#[must_use]
pub fn truncate(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_owned(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

/// Fetch `request` and return the page with its itinerary.
///
/// # Errors
///
/// [`WebError::BadUrl`] for a non-http(s) URL, [`WebError::Http`] / [`WebError::HttpStatus`] on
/// the direct path, and browser errors for browser profiles.
pub async fn fetch(request: &Request) -> Result<Fetched> {
    if !(request.url.starts_with("http://") || request.url.starts_with("https://")) {
        return Err(WebError::BadUrl { url: request.url.clone() });
    }
    match request.profile {
        Some(Profile::Static | Profile::Http) | None => fetch_direct(request).await,
        Some(profile) => fetch_browser(request, profile).await,
    }
}

/// The default path: Aphrody fetches and the local Rust extractor converts.
async fn fetch_direct(request: &Request) -> Result<Fetched> {
    let mut path_taken =
        vec![format!("aphrody http GET (rustls, {}s budget)", request.timeout.as_secs())];

    let response = client()?
        .get(&request.url)
        .timeout(request.timeout)
        .send()
        .await
        .map_err(|e| WebError::Http { url: request.url.clone(), source: Box::new(e) })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();

    // The status is checked, unlike the proxy path this replaces, where a 402 from the reader
    // arrived as page content.
    if !status.is_success() {
        return Err(WebError::HttpStatus { url: final_url, status: status.as_u16() });
    }

    let text = response
        .text()
        .await
        .map_err(|e| WebError::Http { url: request.url.clone(), source: Box::new(e) })?;
    let bytes_in = text.len();

    let (rendering, body) = if is_html(&content_type) || looks_like_html(&text) {
        markdown_body(text, &mut path_taken)
    } else {
        path_taken.push(format!(
            "verbatim ({})",
            if content_type.is_empty() { "no content-type" } else { &content_type }
        ));
        (
            Rendering::Verbatim {
                content_type: if content_type.is_empty() {
                    "unknown".to_owned()
                } else {
                    content_type.clone()
                },
            },
            text,
        )
    };

    let (body, truncated) = truncate(&body, request.max_bytes);
    Ok(Fetched {
        url: request.url.clone(),
        transport: Transport::Direct { final_url, status: status.as_u16() },
        rendering,
        body,
        bytes_in,
        truncated,
        path_taken,
    })
}

fn markdown_body(html: String, path_taken: &mut Vec<String>) -> (Rendering, String) {
    let (cleaned, noise_blocks) = strip_noise_blocks(&html);
    if noise_blocks > 0 {
        path_taken.push(format!("dropped {noise_blocks} script/style/noscript block(s)"));
    }
    let markdown = aphrody_web_extract::html_to_markdown(&cleaned, None);
    path_taken.push("aphrody-web-extract (in-process Rust)".to_owned());
    if markdown.trim().is_empty() && !cleaned.trim().is_empty() {
        path_taken
            .push("markdown conversion returned an empty body - raw HTML returned".to_owned());
        (
            Rendering::RawHtml {
                reason: format!(
                    "aphrody-web-extract produced no text from {} HTML bytes",
                    cleaned.len()
                ),
            },
            html,
        )
    } else {
        (Rendering::Markdown { via: "aphrody-web-extract".to_owned() }, markdown)
    }
}

/// Browser profiles render the page in the local Obscura V8 runtime.
async fn fetch_browser(request: &Request, profile: Profile) -> Result<Fetched> {
    let stealth = matches!(profile, Profile::Stealth | Profile::Max);
    if stealth && !cfg!(feature = "stealth") {
        return Err(WebError::BrowserFeatureMissing { profile: profile.as_str() });
    }

    let url = request.url.clone();
    let budget = request.timeout;
    let allow_private_network = request.allow_private_network;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("aphrody-web-browser-fetch".to_owned())
        .stack_size(64 * 1024 * 1024)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|error| error.to_string())?;
                runtime.block_on(async {
                    let browser = obscura::Browser::builder()
                        .stealth(stealth)
                        .allow_private_network(allow_private_network)
                        .build()
                        .map_err(|error| error.to_string())?;
                    let mut page = browser.new_page().await.map_err(|error| error.to_string())?;
                    tokio::time::timeout(budget, page.goto(&url))
                        .await
                        .map_err(|_| "navigation deadline exceeded".to_owned())?
                        .map_err(|error| error.to_string())?;
                    if matches!(profile, Profile::Max) {
                        page.settle(500).await;
                    }
                    let html = page.content();
                    if html.trim().is_empty() {
                        return Err("browser returned an empty document".to_owned());
                    }
                    Ok((html, page.url()))
                })
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| WebError::Browser {
            url: request.url.clone(),
            detail: error.to_string(),
        })?;

    let (html, final_url) = tokio::time::timeout(budget, receiver)
        .await
        .map_err(|_| WebError::BrowserTimeout { url: request.url.clone(), secs: budget.as_secs() })?
        .map_err(|_| WebError::Browser {
            url: request.url.clone(),
            detail: "browser worker ended without a result".to_owned(),
        })?
        .map_err(|detail| WebError::Browser { url: request.url.clone(), detail })?;

    let bytes_in = html.len();
    let mut path_taken = vec![format!(
        "obscura V8 browser ({} profile, {}s budget)",
        profile.as_str(),
        budget.as_secs()
    )];
    let (rendering, body) = markdown_body(html, &mut path_taken);
    let (body, truncated) = truncate(&body, request.max_bytes);
    Ok(Fetched {
        url: request.url.clone(),
        transport: Transport::Browser { profile, final_url },
        rendering,
        body,
        bytes_in,
        truncated,
        path_taken,
    })
}

/// Elements whose *contents* are code, not prose.
const NOISE_TAGS: [&str; 3] = ["script", "style", "noscript"];

/// Remove `<script>`, `<style>` and `<noscript>` blocks, contents included.
///
/// Measured need, not tidiness: converting `https://example.com` straight through an HTML-to-text
/// converter that keeps the text of a `<style>` element produced a first line reading
/// `Example Domainbody{background:#eee;width:60vw;...}`: the whole stylesheet, inlined into the
/// prose. A model handed that spends tokens on CSS and can quote it back.
///
/// Returns the block count as well as the text. A pass that removes content without saying how
/// much it removed is the failure mode this repository has a name for: it raises nothing, and
/// things simply go missing.
///
/// An unterminated block is **left alone** rather than swallowing the rest of the file:
/// truncating a page at a stray `<script` would lose real content, and losing content silently
/// is the thing being avoided.
#[must_use]
pub fn strip_noise_blocks(html: &str) -> (String, usize) {
    // `to_ascii_lowercase` maps only ASCII A-Z, so byte offsets in `lower` index `html`
    // identically - which is what lets the scan below use one set of indices for both.
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0usize;
    let mut removed = 0usize;

    while cursor < html.len() {
        let Some(offset) = lower[cursor..].find('<') else {
            out.push_str(&html[cursor..]);
            return (out, removed);
        };
        let lt = cursor + offset;
        out.push_str(&html[cursor..lt]);

        let tag = NOISE_TAGS.iter().find(|t| {
            let open = &lower.as_bytes()[lt..];
            let name = t.as_bytes();
            // `<script` must be followed by a delimiter, so `<scripting>` - not a real element,
            // but neither is it this one - is left alone.
            open.len() > 1 + name.len()
                && open[0] == b'<'
                && open[1..=name.len()] == *name
                && matches!(open[1 + name.len()], b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r')
        });

        let Some(tag) = tag else {
            out.push('<');
            cursor = lt + 1;
            continue;
        };

        let close = format!("</{tag}");
        let Some(close_offset) = lower[lt..].find(&close) else {
            // Unterminated: keep the byte, keep the rest of the document.
            out.push('<');
            cursor = lt + 1;
            continue;
        };
        let close_start = lt + close_offset;
        cursor = lower[close_start..].find('>').map_or(html.len(), |gt| close_start + gt + 1);
        removed += 1;
    }

    (out, removed)
}

/// Sniff HTML when the origin sent no usable content type.
///
/// Servers that answer `application/octet-stream` for a `.html` are common enough that trusting
/// the header alone leaves documentation unconverted.
#[must_use]
pub fn looks_like_html(text: &str) -> bool {
    let head = text.get(..512).unwrap_or(text).to_ascii_lowercase();
    head.contains("<!doctype html") || head.contains("<html") || head.contains("<head")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_html_uses_the_rust_extractor() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("local listener");
        let url = format!("http://{}/", listener.local_addr().expect("listener address"));
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("local connection");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).expect("request bytes");
            let html = "<html><body><h1>Rust owner</h1><p>Local content</p></body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
                html.len()
            );
            stream.write_all(response.as_bytes()).expect("response bytes");
        });

        let fetched = fetch(&Request::new(url)).await.expect("local fetch");
        server.join().expect("server thread");
        assert!(matches!(fetched.rendering, Rendering::Markdown { .. }));
        assert!(fetched.body.contains("# Rust owner"), "{}", fetched.body);
        assert!(fetched.path_taken.iter().any(|step| step.contains("aphrody-web-extract")));
    }

    #[test]
    fn only_http_urls_are_accepted() {
        let err = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(fetch(&Request::new("file:///etc/passwd")))
            .unwrap_err();
        assert!(matches!(err, WebError::BadUrl { .. }), "{err}");
    }

    #[test]
    fn profiles_round_trip_and_browser_profiles_are_flagged() {
        for p in [Profile::Static, Profile::Fast, Profile::Http, Profile::Stealth, Profile::Max] {
            assert_eq!(Profile::parse(p.as_str()), Some(p));
        }
        assert_eq!(Profile::parse("  STEALTH "), Some(Profile::Stealth));
        assert_eq!(Profile::parse("turbo"), None);
        assert!(!Profile::Static.needs_browser());
        assert!(!Profile::Http.needs_browser());
        assert!(Profile::Max.needs_browser());
    }

    /// The regression this pass fixes: the stylesheet of example.com used to land in the prose as
    /// `Example Domainbody{background:#eee;...}`.
    #[test]
    fn inline_css_and_javascript_are_removed_with_their_contents() {
        let html = "<html><head><style>body{background:#eee;width:60vw}</style><script>var \
                    a=1<2;</script></head><body><h1>Title</h1><noscript>enable \
                    js</noscript><p>Prose.</p></body></html>";
        let (out, removed) = strip_noise_blocks(html);
        assert_eq!(removed, 3, "script, style and noscript must all go: {out}");
        assert!(!out.contains("background"), "CSS survived: {out}");
        assert!(!out.contains("var a"), "JS survived: {out}");
        assert!(!out.contains("enable js"), "noscript survived: {out}");
        assert!(out.contains("<h1>Title</h1>") && out.contains("Prose."), "prose lost: {out}");
    }

    #[test]
    fn attributes_and_uppercase_tags_do_not_defeat_the_scan() {
        let html = "<STYLE type=\"text/css\">a{}</STYLE><SCRIPT src=\"x.js\"></SCRIPT><p>keep</p>";
        let (out, removed) = strip_noise_blocks(html);
        assert_eq!(removed, 2, "{out}");
        assert_eq!(out, "<p>keep</p>");
    }

    /// A tag whose name merely starts with a noise tag is not one.
    #[test]
    fn a_similarly_named_tag_is_left_alone() {
        let html = "<scripting>keep me</scripting><styles>and me</styles>";
        let (out, removed) = strip_noise_blocks(html);
        assert_eq!(removed, 0, "{out}");
        assert_eq!(out, html);
    }

    /// Truncating at a stray `<script` would lose the rest of the document, and losing content in
    /// silence is the whole thing being avoided.
    #[test]
    fn an_unterminated_block_does_not_swallow_the_document() {
        let html = "<p>before</p><script>never closed <p>after</p>";
        let (out, removed) = strip_noise_blocks(html);
        assert_eq!(removed, 0);
        assert!(out.contains("before") && out.contains("after"), "{out}");
    }

    #[test]
    fn clean_html_passes_through_untouched() {
        let html = "<h1>T</h1><p>Multibyte: \u{e9}\u{4e2d}\u{6587} &amp; more</p>";
        let (out, removed) = strip_noise_blocks(html);
        assert_eq!(removed, 0);
        assert_eq!(out, html, "non-ASCII bytes must survive the ASCII-lowercase index trick");
    }

    #[test]
    fn html_is_recognised_by_header_and_by_shape() {
        assert!(is_html("text/html; charset=utf-8"));
        assert!(is_html("application/xhtml+xml"));
        assert!(!is_html("application/json"));
        assert!(looks_like_html("<!DOCTYPE html><html><head>"));
        assert!(looks_like_html("\n\n  <HTML>"));
        assert!(!looks_like_html("{\"ok\":true}"));
    }

    #[test]
    fn truncation_lands_on_a_character_boundary_and_says_so() {
        let text = "aaaa\u{e9}bbbb";
        let (cut, truncated) = truncate(text, 5);
        assert!(truncated);
        assert_eq!(cut, "aaaa", "must not split the two-byte character");
        let (whole, truncated) = truncate(text, 1024);
        assert!(!truncated);
        assert_eq!(whole, text);
    }

    /// The banner is the only place a model learns that a page came back unconverted, so it has
    /// to say so in words.
    #[test]
    fn a_degraded_answer_announces_itself() {
        let fetched = Fetched {
            url: "https://example.com".into(),
            transport: Transport::Direct { final_url: "https://example.com/".into(), status: 200 },
            rendering: Rendering::RawHtml {
                reason: "aphrody-web-extract produced no text from 6 HTML bytes".into(),
            },
            body: "<html>".into(),
            bytes_in: 6,
            truncated: false,
            path_taken: vec![
                "aphrody http GET".into(),
                "markdown conversion returned empty".into(),
            ],
        };
        let banner = fetched.banner();
        assert!(banner.contains("raw HTML, not Markdown"), "{banner}");
        assert!(banner.contains("produced no text"), "the reason must reach the banner: {banner}");
        assert!(fetched.to_report().contains("<html>"));
    }

    #[test]
    fn a_successful_conversion_reports_the_component_that_did_it() {
        let fetched = Fetched {
            url: "https://example.com".into(),
            transport: Transport::Direct { final_url: "https://example.com/".into(), status: 200 },
            rendering: Rendering::Markdown { via: "aphrody-web-extract".into() },
            body: "# Example".into(),
            bytes_in: 1256,
            truncated: false,
            path_taken: vec![
                "aphrody http GET (rustls, 30s budget)".into(),
                "aphrody-web-extract (in-process Rust)".into(),
            ],
        };
        let banner = fetched.banner();
        assert!(banner.contains("aphrody-web-extract"), "{banner}");
        assert!(!banner.contains("NOTE:"), "a clean path must not warn: {banner}");
        // No third party may appear anywhere in the itinerary.
        assert!(!banner.contains("jina"), "{banner}");
    }
}
