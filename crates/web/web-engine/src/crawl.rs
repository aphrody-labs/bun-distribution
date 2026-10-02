// SPDX-License-Identifier: Apache-2.0
//! `aphrody-web crawl`: the bounded, robots-aware crawler of `aphrody-web-crawl` as a CLI.
//!
//! Static HTTP is the default; `--render` supplies V8-rendered HTML through the same frontier.
//! Robots and sitemaps retain their original response bodies. Output is a stable JSON
//! document (`aphrody-web.crawl/1`), NDJSON or concatenated Markdown.

use std::{cell::RefCell, collections::HashMap, sync::Arc, time::Instant};

use aphrody_web_crawl::{
    AddRequest, CrawlOptions, CrawlPage, CrawlReport, CrawlTransport, FetchResult, Frontier,
    FrontierOptions, ObscuraTransport, crawl_bounded,
};
use aphrody_web_extract::{UrlNormalizationOptions, normalize_page_url};
use clap::{Args, ValueEnum};
use obscura_browser::{BrowserContext, Page};
use obscura_net::{CookieJar, ObscuraHttpClient};
use serde::Serialize;
use tokio::time::{Duration, timeout};
use url::Url;

/// Schema identifier of the JSON report. Bump the suffix on breaking changes.
pub const CRAWL_SCHEMA: &str = "aphrody-web.crawl/1";
/// Hard ceiling accepted for `--max-pages`; larger crawls belong to the persistent frontier API.
const MAX_PAGES_LIMIT: usize = 10_000;
/// Per-page cap on the number of links reported with `--include-links`.
const MAX_REPORTED_LINKS: usize = 500;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum CrawlFormat {
    /// One JSON document with `pages`, `errors` and `stats`.
    #[default]
    Json,
    /// One JSON object per page, then a final `{"summary": ...}` line.
    Ndjson,
    /// Concatenated Markdown of every page, separated by the page URL.
    Markdown,
}

#[derive(Args, Debug)]
pub struct CrawlArgs {
    /// Seed URLs (http or https).
    #[arg(required = true)]
    pub urls: Vec<String>,

    /// Maximum link depth from a seed.
    #[arg(long, default_value_t = 2)]
    pub max_depth: u32,

    /// Maximum number of requests (pages, robots.txt and sitemaps excluded).
    #[arg(long, default_value_t = 25, value_parser = clap::value_parser!(u64).range(1..=MAX_PAGES_LIMIT as u64))]
    pub max_pages: u64,

    /// Concurrent requests.
    #[arg(long, default_value_t = 4, value_parser = clap::value_parser!(u64).range(1..=64))]
    pub concurrency: u64,

    /// Hosts the crawl may visit (subdomains included). Defaults to the seed hosts.
    #[arg(long = "allowed-domain", value_name = "HOST")]
    pub allowed_domains: Vec<String>,

    /// Include only URLs matching one of these regular expressions.
    #[arg(long)]
    pub include_url_regex: Vec<String>,

    /// Reject matching URLs before fetching; exclusions take precedence.
    #[arg(long)]
    pub exclude_url_regex: Vec<String>,

    /// Render page JavaScript through the shared Obscura browser before discovering links.
    #[arg(long)]
    pub render: bool,

    /// Import an existing Cookie-Editor/Obscura JSON cookie file (repeatable).
    #[arg(long = "cookie-file", value_name = "PATH")]
    pub cookie_files: Vec<std::path::PathBuf>,

    /// Honour robots.txt (Disallow and Crawl-delay) for every visited origin.
    #[arg(long)]
    pub obey_robots: bool,

    /// Seed the frontier from robots.txt `Sitemap:` entries and `/sitemap.xml`.
    #[arg(long)]
    pub sitemaps: bool,

    /// Minimum delay between two requests to the same host, in milliseconds.
    #[arg(long, default_value_t = 0)]
    pub delay_ms: u64,

    /// Overall deadline for the crawl, in seconds.
    #[arg(long, default_value_t = 300, value_parser = clap::value_parser!(u64).range(1..))]
    pub timeout: u64,

    /// User-Agent header and robots.txt identity.
    #[arg(long, default_value = "AphrodyWeb/1.0")]
    pub user_agent: String,

    /// Allow loopback and private-network targets (local fixtures, dev servers).
    #[arg(long)]
    pub allow_private_network: bool,

    #[arg(long, value_enum, default_value_t = CrawlFormat::Json)]
    pub format: CrawlFormat,

    /// Attach the extracted Markdown of each page to the JSON/NDJSON output.
    #[arg(long)]
    pub include_markdown: bool,

    /// Attach the raw initial HTML of each page to the JSON/NDJSON output.
    #[arg(long)]
    pub include_html: bool,

    /// Attach the resolved, de-duplicated `<a href>` targets of each page.
    #[arg(long)]
    pub include_links: bool,

    #[arg(long, short = 'o')]
    pub output: Option<std::path::PathBuf>,

    #[arg(long, short)]
    pub quiet: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOut {
    pub url: String,
    pub depth: u32,
    pub status: u16,
    pub content_type: Option<String>,
    pub title: String,
    pub lang: Option<String>,
    pub canonical: Option<String>,
    pub description: Option<String>,
    pub word_count: usize,
    pub text_chars: usize,
    pub markdown_chars: usize,
    pub bytes: Option<usize>,
    pub duplicate: bool,
    pub discovered_links: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ErrorOut {
    pub url: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsOut {
    pub attempts: usize,
    pub pages: usize,
    pub exact_duplicates: usize,
    pub near_duplicates: usize,
    pub robots_fetched: usize,
    pub robots_blocked: usize,
    pub sitemaps_fetched: usize,
    pub sitemap_urls_enqueued: usize,
    pub frontier_pending: u64,
    pub frontier_done: u64,
    pub frontier_failed: u64,
    pub elapsed_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlReportOut {
    pub schema: &'static str,
    pub seeds: Vec<String>,
    pub allowed_domains: Vec<String>,
    pub max_depth: u32,
    pub max_pages: usize,
    pub pages: Vec<PageOut>,
    pub errors: Vec<ErrorOut>,
    pub stats: StatsOut,
}

/// Raw bodies observed by the transport, keyed by normalized response URL.
#[derive(Default)]
struct Captured {
    content_type: Option<String>,
    body: String,
}

/// Supplies static or rendered bodies to the shared frontier and retains report captures.
struct CapturingTransport {
    inner: ObscuraTransport,
    rendered_context: Option<Arc<BrowserContext>>,
    capture: bool,
    bodies: RefCell<HashMap<String, Captured>>,
}

impl CrawlTransport for CapturingTransport {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
        let response = if let Some(context) = &self.rendered_context {
            // Robots and sitemap policy documents are consumed as their original bytes.
            if url.path().ends_with("/robots.txt") || url.path().ends_with(".xml") {
                self.inner.fetch(url).await?
            } else {
                aphrody_web_service::validate_page_url(url.as_str())?;
                let mut page = Page::new("crawl-page".into(), context.clone());
                page.navigate_with_wait(url.as_str(), obscura_browser::lifecycle::WaitUntil::Load)
                    .await
                    .map_err(|error| error.to_string())?;
                let event = page
                    .network_events
                    .iter()
                    .rev()
                    .find(|event| event.resource_type == "Document")
                    .ok_or_else(|| {
                        "rendered navigation did not report a document response".to_string()
                    })?;
                FetchResult {
                    url: page
                        .url
                        .clone()
                        .ok_or_else(|| "rendered navigation has no final URL".to_string())?,
                    status: event.status,
                    content_type: event
                        .response_headers
                        .iter()
                        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
                        .map(|(_, value)| value.clone()),
                    body: super::dump_html(&page),
                }
            }
        } else {
            self.inner.fetch(url).await?
        };
        if self.capture && (200..400).contains(&response.status) {
            let key =
                normalize_page_url(response.url.as_str(), None, UrlNormalizationOptions::default())
                    .map_or_else(|_| response.url.to_string(), |url| url.to_string());
            self.bodies.borrow_mut().insert(
                key,
                Captured {
                    content_type: response.content_type.clone(),
                    body: response.body.clone(),
                },
            );
        }
        Ok(response)
    }
}

/// Seed hosts, lower-cased and de-duplicated, used when no `--allowed-domain` is given.
pub fn seed_hosts(seeds: &[String]) -> Result<Vec<String>, String> {
    let mut hosts = Vec::new();
    for seed in seeds {
        let url = normalize_page_url(seed, None, UrlNormalizationOptions::default())
            .map_err(|error| format!("invalid seed URL {seed:?}: {error}"))?;
        let host = url.host_str().ok_or_else(|| format!("seed URL {seed:?} requires a host"))?;
        let host = host.to_ascii_lowercase();
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    Ok(hosts)
}

/// Resolved, de-duplicated anchor targets of `html`, in document order.
pub fn page_links(html: &str, page_url: &Url) -> Vec<String> {
    aphrody_web_crawl::extract_links_opts(html, page_url, false)
        .into_iter()
        .take(MAX_REPORTED_LINKS)
        .map(|(url, _)| url.to_string())
        .collect()
}

fn page_out(page: &CrawlPage, args: &CrawlArgs, captured: Option<&Captured>) -> PageOut {
    let is_html = captured.is_none_or(|c| {
        c.content_type.as_deref().is_none_or(|kind| kind.contains("html") || kind.contains("xml"))
    });
    PageOut {
        url: page.url.to_string(),
        depth: page.depth,
        status: page.status,
        content_type: captured.and_then(|c| c.content_type.clone()),
        title: page.extracted.title.clone(),
        lang: page.extracted.lang.clone(),
        canonical: page.extracted.canonical.clone(),
        description: page.extracted.description.clone(),
        word_count: page.extracted.word_count,
        text_chars: page.extracted.text.chars().count(),
        markdown_chars: page.extracted.markdown.chars().count(),
        bytes: captured.map(|c| c.body.len()),
        duplicate: page.duplicate,
        discovered_links: page.discovered_links,
        links: (args.include_links && is_html)
            .then(|| captured.map(|c| page_links(&c.body, &page.url)))
            .flatten(),
        markdown: args.include_markdown.then(|| page.extracted.markdown.clone()),
        html: args.include_html.then(|| captured.map(|c| c.body.clone())).flatten(),
    }
}

/// Builds the serializable report. Pure: no I/O, so it is covered by unit tests.
fn build_report(
    report: &CrawlReport,
    args: &CrawlArgs,
    allowed: Vec<String>,
    bodies: &HashMap<String, Captured>,
    elapsed_ms: u128,
) -> CrawlReportOut {
    let pages = report
        .pages
        .iter()
        .map(|page| page_out(page, args, bodies.get(page.url.as_str())))
        .collect::<Vec<_>>();
    CrawlReportOut {
        schema: CRAWL_SCHEMA,
        seeds: args.urls.clone(),
        allowed_domains: allowed,
        max_depth: args.max_depth,
        max_pages: usize::try_from(args.max_pages).unwrap_or(MAX_PAGES_LIMIT),
        stats: StatsOut {
            attempts: report.attempts,
            pages: pages.len(),
            exact_duplicates: report.exact_duplicates,
            near_duplicates: report.near_duplicates,
            robots_fetched: report.robots_fetched,
            robots_blocked: report.robots_blocked,
            sitemaps_fetched: report.sitemaps_fetched,
            sitemap_urls_enqueued: report.sitemap_urls_enqueued,
            frontier_pending: report.frontier.pending,
            frontier_done: report.frontier.done,
            frontier_failed: report.frontier.failed,
            elapsed_ms,
        },
        errors: report
            .errors
            .iter()
            .map(|(url, error)| ErrorOut { url: url.clone(), error: error.clone() })
            .collect(),
        pages,
    }
}

/// Renders the report in the requested format.
pub fn render_report(report: &CrawlReportOut, format: CrawlFormat) -> Result<String, String> {
    match format {
        CrawlFormat::Json => serde_json::to_string_pretty(report).map_err(|e| e.to_string()),
        CrawlFormat::Ndjson => {
            let mut out = String::new();
            for page in &report.pages {
                out.push_str(&serde_json::to_string(page).map_err(|e| e.to_string())?);
                out.push('\n');
            }
            let summary = serde_json::json!({
                "summary": {
                    "schema": report.schema,
                    "seeds": report.seeds,
                    "allowedDomains": report.allowed_domains,
                    "errors": report.errors,
                    "stats": report.stats,
                }
            });
            out.push_str(&summary.to_string());
            Ok(out)
        },
        CrawlFormat::Markdown => Ok(report
            .pages
            .iter()
            .map(|page| {
                format!("<!-- {} -->\n\n{}", page.url, page.markdown.clone().unwrap_or_default())
            })
            .collect::<Vec<_>>()
            .join("\n\n---\n\n")),
    }
}

fn load_cookie_files(paths: &[std::path::PathBuf]) -> anyhow::Result<Arc<CookieJar>> {
    let jar = Arc::new(CookieJar::new());
    for path in paths {
        // The existing jar importer treats absent storage files as empty. An explicitly
        // requested CLI file must exist, and parser errors must never echo cookie values.
        if !path.is_file() {
            anyhow::bail!("cookie file is missing or is not a regular file: {}", path.display());
        }
        jar.load_from_file(path).map_err(|error| {
            anyhow::anyhow!("cannot load cookie file {} ({:?})", path.display(), error.kind())
        })?;
    }
    Ok(jar)
}

pub async fn run_crawl(args: CrawlArgs, proxy: Option<String>) -> anyhow::Result<()> {
    let allowed = if args.allowed_domains.is_empty() {
        seed_hosts(&args.urls).map_err(anyhow::Error::msg)?
    } else {
        args.allowed_domains.iter().map(|host| host.to_ascii_lowercase()).collect()
    };

    let cookie_jar = load_cookie_files(&args.cookie_files)?;
    let client = ObscuraHttpClient::with_full_options(
        cookie_jar.clone(),
        proxy.as_deref(),
        args.allow_private_network,
    );
    client.set_user_agent(&args.user_agent).await;

    let mut frontier = Frontier::memory(FrontierOptions {
        per_host_delay_ms: i64::try_from(args.delay_ms).unwrap_or(i64::MAX),
        ..FrontierOptions::default()
    })?;
    let now_ms = i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX);
    for seed in &args.urls {
        frontier
            .enqueue(AddRequest::seed(seed.clone()), now_ms)
            .map_err(|error| anyhow::anyhow!("cannot enqueue seed {seed:?}: {error}"))?;
    }

    let rendered_context = args.render.then(|| {
        let mut context = BrowserContext::with_storage_and_network(
            "crawl".into(),
            proxy.clone(),
            false,
            Some(args.user_agent.clone()),
            None,
            args.allow_private_network,
        );
        context.cookie_jar = cookie_jar.clone();
        context.http_client = Arc::new(ObscuraHttpClient::with_full_options(
            cookie_jar.clone(),
            proxy.as_deref(),
            args.allow_private_network,
        ));
        Arc::new(context)
    });
    if let Some(context) = &rendered_context {
        context.http_client.set_user_agent(&args.user_agent).await;
    }
    let transport = CapturingTransport {
        inner: ObscuraTransport::new(client),
        rendered_context,
        capture: args.include_html || args.include_links,
        bodies: RefCell::new(HashMap::new()),
    };
    let options = CrawlOptions {
        max_depth: args.max_depth,
        max_requests: usize::try_from(args.max_pages).unwrap_or(MAX_PAGES_LIMIT),
        max_concurrency: if args.render {
            1
        } else {
            usize::try_from(args.concurrency).unwrap_or(4)
        },
        allowed_domains: allowed.clone(),
        include_url_regex: args.include_url_regex.clone(),
        exclude_url_regex: args.exclude_url_regex.clone(),
        obey_robots: args.obey_robots,
        ingest_sitemaps: args.sitemaps,
        user_agent: args.user_agent.clone(),
        ..CrawlOptions::default()
    };

    if !args.quiet {
        eprintln!(
            "Crawling {} seed(s), depth <= {}, <= {} requests, hosts: {}",
            args.urls.len(),
            args.max_depth,
            args.max_pages,
            allowed.join(", ")
        );
    }
    let started = Instant::now();
    let report = match timeout(
        Duration::from_secs(args.timeout),
        crawl_bounded(&mut frontier, &transport, &options),
    )
    .await
    {
        Ok(result) => result?,
        Err(_) => anyhow::bail!("crawl exceeded the {}s deadline", args.timeout),
    };

    let out = build_report(
        &report,
        &args,
        allowed,
        &transport.bodies.borrow(),
        started.elapsed().as_millis(),
    );
    let rendered = render_report(&out, args.format).map_err(anyhow::Error::msg)?;
    if let Some(path) = &args.output {
        tokio::fs::write(path, &rendered)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write {}: {}", path.display(), e))?;
    } else {
        println!("{rendered}");
    }
    if out.pages.is_empty() {
        anyhow::bail!(
            "no page could be crawled ({} error(s); first: {})",
            out.errors.len(),
            out.errors.first().map_or("none", |entry| entry.error.as_str())
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn args(urls: Vec<String>) -> CrawlArgs {
        CrawlArgs {
            urls,
            max_depth: 2,
            max_pages: 10,
            concurrency: 2,
            allowed_domains: Vec::new(),
            include_url_regex: Vec::new(),
            exclude_url_regex: Vec::new(),
            render: false,
            cookie_files: Vec::new(),
            obey_robots: true,
            sitemaps: false,
            delay_ms: 0,
            timeout: 30,
            user_agent: "AphrodyWebTest/1".into(),
            allow_private_network: true,
            format: CrawlFormat::Json,
            include_markdown: true,
            include_html: true,
            include_links: true,
            output: None,
            quiet: true,
        }
    }

    #[test]
    fn cookie_file_import_preserves_scope_and_rejects_invalid_input_without_values() {
        let path =
            std::env::temp_dir().join(format!("aphrody-crawl-cookies-{}.json", std::process::id()));
        let fixtures = serde_json::json!([
            {"name":"host", "value":"fixture", "domain":"example.com", "path":"/account", "hostOnly":true, "secure":false, "httpOnly":true, "session":true, "expirationDate":1.5},
            {"name":"secure", "value":"fixture", "domain":".example.com", "path":"/", "secure":true, "httpOnly":false},
            {"name":"expired", "value":"fixture", "domain":"example.com", "path":"/", "secure":false, "httpOnly":false, "expires":1}
        ]);
        std::fs::write(&path, serde_json::to_vec(&fixtures).unwrap()).unwrap();
        let jar = load_cookie_files(std::slice::from_ref(&path)).unwrap();
        assert_eq!(
            jar.get_cookie_header(&Url::parse("http://example.com/account/profile").unwrap()),
            "host=fixture"
        );
        assert!(
            jar.get_cookie_header(&Url::parse("http://example.com/accounting").unwrap()).is_empty()
        );
        assert!(
            jar.get_cookie_header(&Url::parse("http://sub.example.com/account").unwrap())
                .is_empty()
        );
        assert_eq!(
            jar.get_cookie_header(&Url::parse("https://sub.example.com/").unwrap()),
            "secure=fixture"
        );
        assert!(
            jar.get_cookie_header(&Url::parse("https://elsewhere.example/").unwrap()).is_empty()
        );
        std::fs::write(&path, r#"[{"name":"fixture-secret-value","secure":"private-value"}]"#)
            .unwrap();
        let error = load_cookie_files(std::slice::from_ref(&path)).err().unwrap().to_string();
        assert!(error.contains("InvalidData"));
        assert!(!error.contains("fixture-secret-value"));
        assert!(!error.contains("private-value"));
        std::fs::remove_file(&path).unwrap();
        assert!(load_cookie_files(&[path]).is_err());
    }

    #[tokio::test]
    async fn imported_cookie_is_transmitted_by_native_http_transport() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let size = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..size]).to_ascii_lowercase();
            assert!(request.contains("cookie: auth=fixture"), "fixture cookie was not transmitted");
            let body = "<html><body><h1>Authenticated fixture</h1></body></html>";
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let path = std::env::temp_dir()
            .join(format!("aphrody-crawl-cookie-http-{}.json", std::process::id()));
        std::fs::write(&path, r#"[{"name":"auth","value":"fixture","domain":"127.0.0.1","path":"/","hostOnly":true,"secure":false,"httpOnly":true}]"#).unwrap();
        let jar = load_cookie_files(std::slice::from_ref(&path)).unwrap();
        std::fs::remove_file(path).unwrap();
        let transport =
            ObscuraTransport::new(ObscuraHttpClient::with_full_options(jar, None, true));
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        frontier.enqueue(AddRequest::seed(format!("http://127.0.0.1:{port}/")), 0).unwrap();
        let report = crawl_bounded(
            &mut frontier,
            &transport,
            &CrawlOptions {
                max_requests: 1,
                allowed_domains: vec!["127.0.0.1".into()],
                ..CrawlOptions::default()
            },
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.pages.len(), 1);
    }

    /// Serves fixed pages over loopback HTTP/1.1; every response closes the connection.
    async fn serve(pages: HashMap<&'static str, (&'static str, &'static str)>) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else { return };
                let pages = pages.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let response = match pages.get(path.as_str()) {
                        Some((kind, body)) => format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        ),
                        None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                    };
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        port
    }

    #[test]
    fn seed_hosts_default_to_unique_lowercase_hosts() {
        let hosts = seed_hosts(&[
            "https://Example.TEST/a".into(),
            "https://example.test/b".into(),
            "http://other.test/".into(),
        ])
        .unwrap();
        assert_eq!(hosts, vec!["example.test", "other.test"]);
        assert!(seed_hosts(&["file:///etc/passwd".into()]).is_err());
        assert!(seed_hosts(&["not a url".into()]).is_err());
    }

    #[test]
    fn page_links_resolve_dedupe_and_skip_non_http() {
        let base = Url::parse("https://example.test/docs/").unwrap();
        let links = page_links(
            r##"<a href="a">A</a><a href="/a#frag">dup</a><a href="mailto:x@y.z">m</a><a href="https://elsewhere.test/">E</a><a>no href</a>"##,
            &base,
        );
        assert_eq!(
            links,
            vec![
                "https://example.test/docs/a",
                "https://example.test/a",
                "https://elsewhere.test/"
            ]
        );
    }

    #[test]
    fn ndjson_ends_with_a_summary_line_and_markdown_names_each_page() {
        let report = CrawlReportOut {
            schema: CRAWL_SCHEMA,
            seeds: vec!["https://example.test/".into()],
            allowed_domains: vec!["example.test".into()],
            max_depth: 1,
            max_pages: 1,
            pages: Vec::new(),
            errors: Vec::new(),
            stats: StatsOut {
                attempts: 0,
                pages: 0,
                exact_duplicates: 0,
                near_duplicates: 0,
                robots_fetched: 0,
                robots_blocked: 0,
                sitemaps_fetched: 0,
                sitemap_urls_enqueued: 0,
                frontier_pending: 0,
                frontier_done: 0,
                frontier_failed: 0,
                elapsed_ms: 0,
            },
        };
        let ndjson = render_report(&report, CrawlFormat::Ndjson).unwrap();
        let last: serde_json::Value = serde_json::from_str(ndjson.lines().last().unwrap()).unwrap();
        assert_eq!(last["summary"]["schema"], CRAWL_SCHEMA);
        assert_eq!(render_report(&report, CrawlFormat::Markdown).unwrap(), "");
    }

    #[tokio::test]
    async fn rendered_transport_discovers_script_inserted_links_through_shared_frontier() {
        let port = serve(HashMap::from([
            ("/", ("text/html", r#"<!doctype html><html><body><main><h1>Rendered root</h1><script>const link = document.createElement('a'); link.href = '/hydrated'; link.textContent = 'Hydrated destination'; document.body.appendChild(link);</script></main></body></html>"#)),
            ("/hydrated", ("text/html", "<!doctype html><html><body><main><h1>Hydrated destination</h1><p>Reached exclusively through JavaScript-created links.</p></main></body></html>")),
        ])).await;
        let seed = format!("http://127.0.0.1:{port}/");
        let client = ObscuraHttpClient::with_full_options(Arc::new(CookieJar::new()), None, true);
        let context = Arc::new(BrowserContext::with_storage_and_network(
            "rendered-crawl-test".into(),
            None,
            false,
            None,
            None,
            true,
        ));
        let transport = CapturingTransport {
            inner: ObscuraTransport::new(client),
            rendered_context: Some(context),
            capture: true,
            bodies: RefCell::new(HashMap::new()),
        };
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        frontier.enqueue(AddRequest::seed(seed), 0).unwrap();
        let options = CrawlOptions {
            max_depth: 1,
            max_requests: 2,
            max_concurrency: 1,
            allowed_domains: vec!["127.0.0.1".into()],
            ..CrawlOptions::default()
        };
        let report = crawl_bounded(&mut frontier, &transport, &options).await.unwrap();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.pages.len(), 2);
        assert!(report.pages.iter().any(|page| page.url.path() == "/hydrated"));
        assert!(
            transport.bodies.borrow().values().any(|body| body.body.contains("href=\"/hydrated\""))
        );
    }

    #[tokio::test]
    async fn crawl_follows_links_honours_robots_and_stays_on_host() {
        let port = serve(HashMap::from([
            (
                "/robots.txt",
                ("text/plain", "User-agent: *\nDisallow: /private\n"),
            ),
            (
                "/",
                (
                    "text/html",
                    "<!doctype html><html lang=\"fr\"><head><title>Accueil</title></head><body><main><h1>Accueil</h1><p>Une page d'accueil avec assez de contenu pour etre extraite correctement par le moteur.</p><a href=\"/next\">Suite</a><a href=\"/private\">Prive</a><a href=\"https://elsewhere.invalid/\">Dehors</a></main></body></html>",
                ),
            ),
            (
                "/next",
                (
                    "text/html",
                    "<!doctype html><html><head><title>Suite</title></head><body><main><h1>Suite</h1><p>Une seconde page avec un contenu different, suffisamment long pour etre extrait.</p></main></body></html>",
                ),
            ),
            ("/private", ("text/html", "<main><h1>Secret</h1><p>ne doit pas etre visite</p></main>")),
        ]))
        .await;
        let seed = format!("http://127.0.0.1:{port}/");
        let args = args(vec![seed.clone()]);
        let client = ObscuraHttpClient::with_full_options(Arc::new(CookieJar::new()), None, true);
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        frontier.enqueue(AddRequest::seed(seed.clone()), 0).unwrap();
        let transport = CapturingTransport {
            inner: ObscuraTransport::new(client),
            rendered_context: None,
            capture: true,
            bodies: RefCell::new(HashMap::new()),
        };
        let options = CrawlOptions {
            max_depth: 2,
            max_requests: 10,
            allowed_domains: vec!["127.0.0.1".into()],
            obey_robots: true,
            user_agent: args.user_agent.clone(),
            ..CrawlOptions::default()
        };
        let report = crawl_bounded(&mut frontier, &transport, &options).await.unwrap();
        let out =
            build_report(&report, &args, vec!["127.0.0.1".into()], &transport.bodies.borrow(), 1);

        let urls: Vec<&str> = out.pages.iter().map(|page| page.url.as_str()).collect();
        assert!(urls.contains(&seed.as_str()), "{urls:?}");
        assert!(urls.iter().any(|url| url.ends_with("/next")), "{urls:?}");
        assert!(!urls.iter().any(|url| url.ends_with("/private")), "robots must block /private");
        assert!(!urls.iter().any(|url| url.contains("elsewhere.invalid")));
        assert_eq!(out.stats.robots_blocked, 1);

        let home = out.pages.iter().find(|page| page.url == seed).unwrap();
        assert_eq!(home.title, "Accueil");
        assert_eq!(home.lang.as_deref(), Some("fr"));
        assert!(home.html.as_deref().is_some_and(|html| html.contains("<main>")));
        let links = home.links.as_ref().unwrap();
        assert!(links.iter().any(|link| link.ends_with("/next")));
        assert!(links.iter().any(|link| link.contains("elsewhere.invalid")));
        assert!(home.markdown.as_deref().is_some_and(|md| md.contains("Accueil")));
    }
}
