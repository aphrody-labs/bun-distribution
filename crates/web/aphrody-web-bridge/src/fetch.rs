// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Fetching a page and turning it into Markdown, without a third party.
//!
//! # What this replaces
//!
//! `crates/google_mcp/src/main.rs` used to answer every `universal_web_fetch`
//! and every `coding_style_guide` with
//! `reqwest::get(format!("https://r.jina.ai/{url}"))`. That single line meant:
//! a third-party reader saw the URL, the source IP and the timing of every
//! page the model read; there was no timeout, no user agent, no size cap; and
//! the HTTP status was never inspected, so a `402` or `429` from the proxy was
//! handed to the model as though it were the page. The repository cap is
//! local-first (`CLAUDE.md` §0); routing every read through a rented reader is
//! the opposite of that.
//!
//! # The network decision, stated on purpose
//!
//! Reading a web page needs the network. What it does **not** need is a second
//! remote party. So the default path here is:
//!
//! 1. aphrody fetches the bytes itself, over its own rustls client, with a timeout, a real user
//!    agent, a size cap and a status check;
//! 2. the bytes are converted to Markdown in this process by the canonical
//!    `aphrody-web-extract` Rust crate.
//!
//! The only host contacted is the origin the caller asked for. No proxy, no
//! reader service, no API key, nothing to rate-limit us.
//!
//! Browser-grade retrieval - JavaScript rendering, stealth, bxc cache - is a
//! different job, and it is available by naming a [`Profile`]: that routes
//! through the `bxc` executable instead. It is opt-in because it costs a
//! browser launch, and because bxc escalates profiles on failure, which can
//! turn one blocked request into five.
//!
//! # Nothing degrades in silence
//!
//! An empty Markdown result from nonempty HTML returns the original HTML with
//! [`Rendering::RawHtml`] and a reason. [`Fetched::path_taken`] records the
//! actual Rust converter, while the serialized `via` marker remains stable.

use std::{sync::OnceLock, time::Duration};

use crate::{
    cli::{BxcCli, Profile, SCRAPE_BUDGET},
    error::{BxcError, Result},
};

/// Default per-request timeout.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Default cap on the bytes read from an origin (2 MiB).
///
/// Generous for documentation, small enough that a mis-typed URL pointing at a
/// disk image cannot exhaust memory.
pub const DEFAULT_MAX_BYTES: usize = 2 * 1024 * 1024;

/// User agent used for direct fetches.
///
/// A realistic browser string, for the same reason
/// `aphrody-tools::builtin::scraping` uses one: a CLI-shaped agent is refused
/// by a large share of documentation hosts, and a refusal that arrives as an
/// empty page is worse than a slow one.
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
    /// The `bxc` executable fetched them.
    BxcCli {
        /// The executable that ran.
        bin: String,
        /// The profile requested (bxc may have escalated past it).
        profile: Profile,
        /// Whether the child had to be killed on the deadline.
        killed_on_timeout: bool,
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
    /// This variant exists so that a degraded answer is legible as degraded.
    /// The alternative - handing back HTML that merely looks like a bad
    /// conversion - is the failure this bridge was built to remove.
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
    /// Tools return a `String` to the model, and a model that cannot tell a
    /// converted page from raw HTML will happily quote a `<div>` back at the
    /// user. The banner makes the difference visible in the one place the
    /// model actually reads.
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
    /// Ask bxc to fetch it with this profile instead of fetching directly.
    pub profile: Option<Profile>,
    /// Per-request timeout for the direct path.
    pub timeout: Duration,
    /// Cap on the returned body.
    pub max_bytes: usize,
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
        }
    }

    /// Route through the `bxc` executable with this profile.
    #[must_use]
    pub fn with_profile(mut self, profile: Profile) -> Self {
        self.profile = Some(profile);
        self
    }

    /// Override the request budget, on **both** paths.
    ///
    /// It bounds the direct rustls fetch and the `bxc` child alike, downward as
    /// well as upward. On the `bxc` path a budget under [`SCRAPE_BUDGET`] is
    /// obeyed and announced in [`Fetched::path_taken`], because `bxc scrape`
    /// never exits on its own and cutting early can truncate the page.
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
}

/// Shared HTTP client for the direct path.
///
/// One TLS stack and one connection pool per process, as
/// `aphrody-tools::builtin::web_fetch` already does. Built lazily so a process
/// that never fetches never pays for it, and so the rustls provider only has
/// to be installed before the *first* fetch rather than before startup.
fn client() -> Result<&'static reqwest::Client> {
    static CLIENT: OnceLock<core::result::Result<reqwest::Client, String>> = OnceLock::new();
    match CLIENT.get_or_init(|| {
        // The workspace pins reqwest to `rustls-no-provider`, so rustls 0.23
        // has no default crypto provider until somebody installs one - and it
        // does not fail politely: the first request **panics** with "No
        // provider set", inside reqwest, at send time (measured 2026-09-07 in
        // `tests/bxc_smoke.rs`). `crates/cli` and `crates/google_mcp` both
        // install `ring` at startup, but a panic that takes down an MCP server
        // because a future caller forgot is not an acceptable failure mode for
        // a library. Installing here is idempotent: `install_default` returns
        // `Err` when a provider is already set, which is exactly the
        // no-op we want, so the result is deliberately discarded.
        let _ = rustls::crypto::ring::default_provider().install_default();

        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            // 10 redirects is reqwest default; documentation hosts chain a
            // few (http -> https -> canonical locale), so keep it.
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
            Err(BxcError::Http { url: "<client init>".to_owned(), source: detail.clone().into() })
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
/// Returns the text and whether anything was removed - the caller reports the
/// truncation rather than handing back a silently shortened document.
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
/// [`BxcError::BadUrl`] for a non-http(s) URL, [`BxcError::Http`] /
/// [`BxcError::HttpStatus`] on the direct path, and the `Cli*` family when a
/// profile routed the request through the `bxc` executable.
pub async fn fetch(request: &Request) -> Result<Fetched> {
    if !(request.url.starts_with("http://") || request.url.starts_with("https://")) {
        return Err(BxcError::BadUrl { url: request.url.clone() });
    }
    match request.profile {
        Some(profile) => fetch_via_bxc(request, profile).await,
        None => fetch_direct(request).await,
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
        .map_err(|e| BxcError::Http { url: request.url.clone(), source: Box::new(e) })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();

    // The status is checked, unlike the proxy path this replaces, where a 402
    // from the reader arrived as page content.
    if !status.is_success() {
        return Err(BxcError::HttpStatus { url: final_url, status: status.as_u16() });
    }

    let text = response
        .text()
        .await
        .map_err(|e| BxcError::Http { url: request.url.clone(), source: Box::new(e) })?;
    let bytes_in = text.len();

    let (rendering, body) = if is_html(&content_type) || looks_like_html(&text) {
        let (cleaned, noise_blocks) = strip_noise_blocks(&text);
        // The converter is a local Rust library. Keep the serialized `via`
        // marker for existing clients while recording the real backend here.
        let md = aphrody_web_extract::html_to_markdown(&cleaned, None);
        if noise_blocks > 0 {
            path_taken.push(format!("dropped {noise_blocks} script/style/noscript block(s)"));
        }
        path_taken.push("aphrody-web-extract (in-process Rust)".to_owned());
        if md.trim().is_empty() && !cleaned.trim().is_empty() {
            path_taken
                .push("markdown conversion returned an EMPTY body - raw HTML returned".to_owned());
            (
                Rendering::RawHtml {
                    reason: format!(
                        "bxc_html_to_markdown produced nothing from {} bytes of HTML",
                        cleaned.len()
                    ),
                },
                text,
            )
        } else {
            (Rendering::Markdown { via: "bxc_rust_bridge:bxc_html_to_markdown".to_owned() }, md)
        }
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

/// The opt-in path: the `bxc` executable does the retrieval and the rendering.
async fn fetch_via_bxc(request: &Request, profile: Profile) -> Result<Fetched> {
    let cli = BxcCli::discover()?;

    // The caller's budget is honoured, including downward. An earlier version
    // took `max(request.timeout, SCRAPE_BUDGET)`, which silently raised a
    // 5-second request to 90 — measured: `budget_floor_probe` returned in
    // 90.03 s for a 5 s budget. The floor exists for a real reason
    // (see `SCRAPE_BUDGET`: `scrape` never exits, and cutting too early yields
    // an empty body), but raising someone's deadline without telling them is
    // the silent degradation this crate exists to remove. So we obey, and when
    // the budget sits under the measured floor we say so in the itinerary —
    // the caller then reads *why* the body came back short instead of guessing.
    let budget = request.timeout;
    let under_floor = budget < SCRAPE_BUDGET;

    let (body, run) = cli.scrape_markdown(&request.url, Some(profile), budget).await?;

    let mut path_taken = vec![format!(
        "bxc scrape --markdown --profile {} ({})",
        profile.as_str(),
        cli.path().display()
    )];
    if under_floor {
        path_taken.push(format!(
            "caller budget {}s is below the measured {}s floor for `bxc scrape`: the page may be \
             cut short",
            budget.as_secs(),
            SCRAPE_BUDGET.as_secs()
        ));
    }
    if run.timed_out {
        // Expected, not exceptional: `scrape` writes the page and then hangs.
        path_taken.push(format!(
            // Do not claim the output was complete. `scrape` never exits, so
            // a kill is expected — but nothing here observed the end of the
            // page, and the 20 s row of the SCRAPE_BUDGET table shows a kill
            // that yielded zero bytes. Report what is known: it was killed,
            // and how much arrived.
            "child killed after {}s (bxc scrape never exits); {} bytes had arrived",
            budget.as_secs(),
            body.len()
        ));
    }
    if profile.needs_browser() {
        path_taken.push("browser profile: requires Chromium on this machine".to_owned());
    }

    let bytes_in = body.len();
    let (body, cut_at_cap) = truncate(&body, request.max_bytes);
    // A body cut short by the kill is truncated in every sense the caller
    // cares about, so the flag has to say so. It used to report only the
    // size cap, which meant `truncated == false` on a page the deadline had
    // clipped — the prose in `path_taken` said one thing and the field a
    // machine reads said another.
    let truncated = cut_at_cap || run.timed_out;
    Ok(Fetched {
        url: request.url.clone(),
        transport: Transport::BxcCli {
            bin: cli.path().display().to_string(),
            profile,
            killed_on_timeout: run.timed_out,
        },
        rendering: Rendering::Markdown {
            via: format!("bxc scrape --markdown ({})", profile.as_str()),
        },
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
/// Measured need, not tidiness: converting `https://example.com` straight
/// through the former `bxc_html_to_markdown` path produced a first line reading
/// `Example Domainbody{background:#eee;width:60vw;...}` - the whole stylesheet,
/// inlined into the prose, because `html2md` on the bxc side keeps the text of
/// a `<style>` element. A model handed that spends tokens on CSS and can quote
/// it back. The reader service this bridge replaces did drop these blocks, so
/// not doing it would be a visible regression.
///
/// Returns the block count as well as the text. A pass that removes content
/// without saying how much it removed is the failure mode this repository has
/// a name for (`CLAUDE.md` §7), and here it would be removing part of a
/// document a human is about to read.
///
/// An unterminated block is **left alone** rather than swallowing the rest of
/// the file: truncating a page at a stray `<script` would lose real content,
/// and losing content silently is the thing being avoided.
#[must_use]
pub fn strip_noise_blocks(html: &str) -> (String, usize) {
    // `to_ascii_lowercase` maps only ASCII A-Z, so byte offsets in `lower`
    // index `html` identically - which is what lets the scan below use one
    // set of indices for both.
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
            // `<script` must be followed by a delimiter, so `<scripting>` -
            // not a real element, but neither is it this one - is left alone.
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
/// Servers that answer `application/octet-stream` for a `.html` are common
/// enough that trusting the header alone leaves documentation unconverted.
#[must_use]
pub fn looks_like_html(text: &str) -> bool {
    let head = text.get(..512).unwrap_or(text).to_ascii_lowercase();
    head.contains("<!doctype html") || head.contains("<html") || head.contains("<head")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_html_uses_rust_extractor_without_loading_the_cdylib() {
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
        assert!(!fetched.path_taken.iter().any(|step| step.contains("cdylib")));
    }

    #[test]
    fn only_http_urls_are_accepted() {
        let err = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(fetch(&Request::new("file:///etc/passwd")))
            .unwrap_err();
        assert!(matches!(err, BxcError::BadUrl { .. }), "{err}");
    }

    /// The exact regression this pass fixes: the stylesheet of example.com
    /// used to land in the prose as `Example Domainbody{background:#eee;...}`.
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

    /// Truncating at a stray `<script` would lose the rest of the document,
    /// and losing content in silence is the whole thing being avoided.
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

    /// The banner is the only place a model learns that a page came back
    /// unconverted, so it has to say so in words.
    #[test]
    fn a_degraded_answer_announces_itself() {
        let fetched = Fetched {
            url: "https://example.com".into(),
            transport: Transport::Direct { final_url: "https://example.com/".into(), status: 200 },
            rendering: Rendering::RawHtml {
                reason: "bxc bridge library not found. Fix: set APHRODY_BXC_LIB".into(),
            },
            body: "<html>".into(),
            bytes_in: 6,
            truncated: false,
            path_taken: vec!["aphrody http GET".into(), "markdown conversion UNAVAILABLE".into()],
        };
        let banner = fetched.banner();
        assert!(banner.contains("raw HTML, not Markdown"), "{banner}");
        assert!(
            banner.contains("APHRODY_BXC_LIB"),
            "the fix must survive into the banner: {banner}"
        );
        assert!(fetched.to_report().contains("<html>"));
    }

    #[test]
    fn a_successful_conversion_reports_the_component_that_did_it() {
        let fetched = Fetched {
            url: "https://example.com".into(),
            transport: Transport::Direct { final_url: "https://example.com/".into(), status: 200 },
            rendering: Rendering::Markdown { via: "bxc_rust_bridge:bxc_html_to_markdown".into() },
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
