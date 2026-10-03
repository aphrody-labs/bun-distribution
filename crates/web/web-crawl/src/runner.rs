// SPDX-License-Identifier: Apache-2.0

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use aphrody_web_extract::{
    Extracted, UrlNormalizationOptions, extract_main, normalize_page_url, simhash64,
};
use futures::{StreamExt, stream::FuturesUnordered};
use obscura_dom::parse_html;
use obscura_net::ObscuraHttpClient;
use regex::Regex;
use url::Url;

use crate::frontier::{AddRequest, Frontier, FrontierStats, PageRecord, StoredPage};
use crate::robots::RobotsFile;
use crate::sitemap::{parse_sitemap, seed_boost};

pub struct FetchResult {
    pub url: Url,
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
}

// Browser transports can own a V8 isolate and yield !Send futures. The runner
// polls them on its caller's task and does not promise cross-thread execution.
#[allow(async_fn_in_trait)]
pub trait CrawlTransport {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String>;
}

/// Static HTTP transport through the existing Obscura network stack.
pub struct ObscuraTransport {
    client: ObscuraHttpClient,
}

impl Default for ObscuraTransport {
    fn default() -> Self {
        Self { client: ObscuraHttpClient::new() }
    }
}

impl ObscuraTransport {
    #[must_use]
    pub fn new(client: ObscuraHttpClient) -> Self {
        Self { client }
    }
}

impl CrawlTransport for ObscuraTransport {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
        let response = self.client.fetch(url).await.map_err(|error| error.to_string())?;
        Ok(FetchResult {
            url: response.url.clone(),
            status: response.status,
            content_type: response.content_type().map(str::to_owned),
            body: response.text(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct CrawlOptions {
    pub max_depth: u32,
    pub max_requests: usize,
    pub max_concurrency: usize,
    pub allowed_domains: Vec<String>,
    /// URL regex filters applied before fetching. Excludes always take priority.
    pub include_url_regex: Vec<String>,
    pub exclude_url_regex: Vec<String>,
    pub max_links_per_page: usize,
    pub obey_robots: bool,
    pub ingest_sitemaps: bool,
    pub user_agent: String,
    pub max_sitemaps: usize,
    pub wait_for_revisits: bool,
}

impl Default for CrawlOptions {
    fn default() -> Self {
        Self {
            max_depth: 2,
            max_requests: 25,
            max_concurrency: 4,
            allowed_domains: Vec::new(),
            include_url_regex: Vec::new(),
            exclude_url_regex: Vec::new(),
            max_links_per_page: 10_000,
            obey_robots: false,
            ingest_sitemaps: false,
            user_agent: "AphrodyWeb/1.0".into(),
            max_sitemaps: 25,
            wait_for_revisits: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CrawlPage {
    pub url: Url,
    pub depth: u32,
    pub status: u16,
    pub extracted: Extracted,
    pub duplicate: bool,
    pub discovered_links: usize,
}

#[derive(Debug, Default)]
pub struct CrawlReport {
    pub pages: Vec<CrawlPage>,
    pub attempts: usize,
    pub exact_duplicates: usize,
    pub near_duplicates: usize,
    pub errors: Vec<(String, String)>,
    pub robots_fetched: usize,
    pub robots_blocked: usize,
    pub sitemaps_fetched: usize,
    pub sitemap_urls_enqueued: usize,
    pub frontier: FrontierStats,
}

/// Drains a bounded portion of the shared frontier. A transport can be swapped
/// for a browser renderer or deterministic fixture without changing scheduling.
pub async fn crawl_bounded<T: CrawlTransport>(
    frontier: &mut Frontier,
    transport: &T,
    options: &CrawlOptions,
) -> rusqlite::Result<CrawlReport> {
    let mut report = CrawlReport::default();
    let mut active = FuturesUnordered::new();
    let concurrency = options.max_concurrency.clamp(1, 128);
    let allowed: HashSet<String> =
        options.allowed_domains.iter().map(|s| s.to_ascii_lowercase()).collect();
    let include_url_regex = match compile_url_patterns(&options.include_url_regex, "include") {
        Ok(patterns) => patterns,
        Err(error) => {
            report.errors.push(("include-url-regex".into(), error));
            return Ok(report);
        },
    };
    let exclude_url_regex = match compile_url_patterns(&options.exclude_url_regex, "exclude") {
        Ok(patterns) => patterns,
        Err(error) => {
            report.errors.push(("exclude-url-regex".into(), error));
            return Ok(report);
        },
    };
    let mut robots = HashMap::<String, RobotsFile>::new();
    if options.ingest_sitemaps {
        ingest_seed_sitemaps(frontier, transport, options, &allowed, &mut robots, &mut report)
            .await?;
    }

    loop {
        while active.len() < concurrency && report.attempts < options.max_requests {
            let Some(lease) = frontier.lease_next(now_ms())? else { break };
            report.attempts += 1;
            if !domain_allowed(&lease.url, &allowed) {
                frontier.mark_rejected(&lease, "URL is outside allowed_domains")?;
                report
                    .errors
                    .push((lease.url.to_string(), "URL is outside allowed_domains".into()));
                continue;
            }
            if !url_matches_filters(&lease.url, &include_url_regex, &exclude_url_regex) {
                frontier.mark_rejected(&lease, "URL excluded by crawl plan")?;
                continue;
            }
            if options.obey_robots {
                let policy = load_robots(&lease.url, transport, &mut robots, &mut report).await;
                if let Some(delay) = policy.crawl_delay_ms(&options.user_agent) {
                    frontier.set_host_delay(lease.url.host_str().unwrap_or_default(), delay)?;
                }
                if !policy.allows(&lease.url, &options.user_agent) {
                    frontier.mark_rejected(&lease, "robots.txt disallows URL")?;
                    report.robots_blocked += 1;
                    continue;
                }
            }
            active.push(async move {
                let result = transport.fetch(&lease.url).await;
                (lease, result)
            });
        }

        if active.is_empty() {
            if report.attempts >= options.max_requests {
                break;
            }
            let stats = frontier.stats()?;
            if stats.pending == 0 && !options.wait_for_revisits {
                break;
            }
            let next = if stats.pending > 0 {
                frontier.next_ready_at()?
            } else {
                frontier.next_revisit_at()?
            };
            let Some(next) = next else { break };
            let delay = next.saturating_sub(now_ms());
            tokio::time::sleep(std::time::Duration::from_millis(delay.clamp(1, 1_000) as u64))
                .await;
            continue;
        }

        let Some((lease, result)) = active.next().await else { break };
        match result {
            Ok(response) if (200..400).contains(&response.status) => {
                let response_url = normalize_page_url(
                    response.url.as_str(),
                    None,
                    UrlNormalizationOptions::default(),
                )
                .unwrap_or_else(|_| lease.url.clone());
                if !domain_allowed(&response_url, &allowed) {
                    frontier.mark_rejected(&lease, "redirect left allowed_domains")?;
                    report
                        .errors
                        .push((lease.url.to_string(), "redirect left allowed_domains".into()));
                    continue;
                }
                let is_html = response
                    .content_type
                    .as_deref()
                    .is_none_or(|kind| kind.contains("html") || kind.contains("xml"));
                let extracted = if is_html {
                    extract_main(&response.body, Some(response_url.as_str()))
                } else {
                    Extracted::default()
                };
                let hash_text =
                    if extracted.text.trim().is_empty() { &response.body } else { &extracted.text };
                let record = PageRecord {
                    title: extracted.title.clone(),
                    markdown: extracted.markdown.clone(),
                    content_hash: blake3::hash(hash_text.as_bytes()).to_hex().to_string(),
                    simhash: simhash64(&extracted.text),
                };
                let status = frontier.mark_done(&lease, &record, now_ms())?;
                let mut discovered_links = 0;
                if is_html && lease.depth < options.max_depth && status == StoredPage::New {
                    let links = extract_links(&response.body, &response_url)
                        .into_iter()
                        .filter(|(url, _)| {
                            domain_allowed(url, &allowed)
                                && url_matches_filters(url, &include_url_regex, &exclude_url_regex)
                        })
                        .take(options.max_links_per_page);
                    discovered_links = frontier.enqueue_children(&lease, links, now_ms())?;
                }
                match status {
                    StoredPage::ExactDuplicate => report.exact_duplicates += 1,
                    StoredPage::NearDuplicate => report.near_duplicates += 1,
                    StoredPage::New => {},
                }
                report.pages.push(CrawlPage {
                    url: response_url,
                    depth: lease.depth,
                    status: response.status,
                    extracted,
                    duplicate: status != StoredPage::New,
                    discovered_links,
                });
            },
            Ok(response) => {
                let error = format!("HTTP {}", response.status);
                frontier.mark_failed(&lease, &error)?;
                report.errors.push((lease.url.to_string(), error));
            },
            Err(error) => {
                frontier.mark_failed(&lease, &error)?;
                report.errors.push((lease.url.to_string(), error));
            },
        }
    }
    report.frontier = frontier.stats()?;
    Ok(report)
}

/// Configuration options for the 24/7 continuous crawl daemon.
#[derive(Debug, Clone)]
pub struct CrawlDaemonOptions {
    /// Bounded options applied to each crawl iteration / scheduling batch.
    pub base: CrawlOptions,
    /// Delay in milliseconds when no ready URLs or revisits are available.
    pub idle_poll_ms: u64,
    /// Interval in milliseconds to run frontier maintenance (stale lock recovery, revisit promotion).
    pub maintenance_interval_ms: u64,
    /// Maximum consecutive errors or loop iterations before returning (None = run indefinitely).
    pub max_iterations: Option<usize>,
}

impl Default for CrawlDaemonOptions {
    fn default() -> Self {
        Self {
            base: CrawlOptions {
                wait_for_revisits: true,
                ..CrawlOptions::default()
            },
            idle_poll_ms: 1_000,
            maintenance_interval_ms: 10_000,
            max_iterations: None,
        }
    }
}

/// Continuous 24/7 crawl daemon that loops asynchronously over the frontier,
/// handling stale recovery, revisit promotion, and backoff during idle periods.
pub async fn crawl_daemon<T: CrawlTransport>(
    frontier: &mut Frontier,
    transport: &T,
    options: &CrawlDaemonOptions,
    shutdown: Option<tokio::sync::watch::Receiver<bool>>,
) -> rusqlite::Result<CrawlReport> {
    let mut accumulated = CrawlReport::default();
    let mut last_maintenance = now_ms();
    let mut iterations = 0;

    loop {
        if let Some(ref rx) = shutdown {
            if *rx.borrow() {
                break;
            }
        }
        if let Some(max_iter) = options.max_iterations {
            if iterations >= max_iter {
                break;
            }
        }
        iterations += 1;

        let current_time = now_ms();
        if current_time.saturating_sub(last_maintenance) >= options.maintenance_interval_ms as i64 {
            let _ = frontier.recover_stale(current_time);
            let _ = frontier.promote_due_revisits(current_time);
            last_maintenance = current_time;
        }

        let step_report = crawl_bounded(frontier, transport, &options.base).await?;
        let pages_count = step_report.pages.len();
        accumulated.attempts += step_report.attempts;
        accumulated.exact_duplicates += step_report.exact_duplicates;
        accumulated.near_duplicates += step_report.near_duplicates;
        accumulated.robots_fetched += step_report.robots_fetched;
        accumulated.robots_blocked += step_report.robots_blocked;
        accumulated.sitemaps_fetched += step_report.sitemaps_fetched;
        accumulated.sitemap_urls_enqueued += step_report.sitemap_urls_enqueued;
        accumulated.errors.extend(step_report.errors);
        accumulated.pages.extend(step_report.pages);
        accumulated.frontier = step_report.frontier;

        if pages_count == 0 {
            let stats = frontier.stats()?;
            if stats.pending == 0 {
                let next_revisit = frontier.next_revisit_at()?;
                let sleep_duration = match next_revisit {
                    Some(due) if due > current_time => {
                        let diff = (due - current_time) as u64;
                        diff.min(options.idle_poll_ms)
                    },
                    _ => options.idle_poll_ms,
                };
                tokio::time::sleep(std::time::Duration::from_millis(sleep_duration)).await;
            }
        }
    }

    accumulated.frontier = frontier.stats()?;
    Ok(accumulated)
}

fn now_ms() -> i64 {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    i64::try_from(millis).unwrap_or(i64::MAX)
}

fn domain_allowed(url: &Url, allowed: &HashSet<String>) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    allowed.is_empty()
        || allowed.iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn url_matches_filters(url: &Url, include: &[Regex], exclude: &[Regex]) -> bool {
    let value = url.as_str();
    !exclude.iter().any(|pattern| pattern.is_match(value))
        && (include.is_empty() || include.iter().any(|pattern| pattern.is_match(value)))
}

fn compile_url_patterns(patterns: &[String], kind: &str) -> Result<Vec<Regex>, String> {
    patterns
        .iter()
        .map(|pattern| {
            Regex::new(pattern)
                .map_err(|error| format!("invalid {kind} URL regex {pattern:?}: {error}"))
        })
        .collect()
}

async fn load_robots<'a, T: CrawlTransport>(
    page_url: &Url,
    transport: &T,
    cache: &'a mut HashMap<String, RobotsFile>,
    report: &mut CrawlReport,
) -> &'a RobotsFile {
    let origin = page_url.origin().ascii_serialization();
    if !cache.contains_key(&origin) {
        let robots_url = page_url.join("/robots.txt").expect("HTTP page URL has an origin");
        let content = match transport.fetch(&robots_url).await {
            Ok(response) if response.status < 400 && response.body.len() <= 1024 * 1024 => {
                report.robots_fetched += 1;
                response.body
            },
            _ => String::new(),
        };
        cache.insert(origin.clone(), RobotsFile::parse(&robots_url, &content));
    }
    &cache[&origin]
}

async fn ingest_seed_sitemaps<T: CrawlTransport>(
    frontier: &mut Frontier,
    transport: &T,
    options: &CrawlOptions,
    allowed: &HashSet<String>,
    robots: &mut HashMap<String, RobotsFile>,
    report: &mut CrawlReport,
) -> rusqlite::Result<()> {
    let mut origins = HashSet::new();
    let mut sitemap_queue = VecDeque::new();
    for raw in frontier.known_urls()? {
        let Ok(url) = Url::parse(&raw) else { continue };
        if !domain_allowed(&url, allowed) || !origins.insert(url.origin().ascii_serialization()) {
            continue;
        }
        let policy = load_robots(&url, transport, robots, report).await;
        if options.obey_robots
            && let Some(delay) = policy.crawl_delay_ms(&options.user_agent)
        {
            frontier.set_host_delay(url.host_str().unwrap_or_default(), delay)?;
        }
        if policy.sitemaps().is_empty() {
            if let Ok(fallback) = url.join("/sitemap.xml") {
                sitemap_queue.push_back(fallback);
            }
        } else {
            sitemap_queue.extend(policy.sitemaps().iter().cloned());
        }
        if origins.len() >= 32 {
            break;
        }
    }
    let mut seen = HashSet::new();
    let limit = options.max_sitemaps.min(100);
    let mut attempts = 0;
    while attempts < limit {
        let Some(url) = sitemap_queue.pop_front() else { break };
        if !domain_allowed(&url, allowed) || !seen.insert(url.as_str().to_owned()) {
            continue;
        }
        attempts += 1;
        let Ok(response) = transport.fetch(&url).await else { continue };
        if !(200..400).contains(&response.status) || response.body.len() > 16 * 1024 * 1024 {
            continue;
        }
        report.sitemaps_fetched += 1;
        let parsed = parse_sitemap(&response.body, &url);
        for nested in parsed.sitemaps {
            if domain_allowed(&nested, allowed) && !seen.contains(nested.as_str()) {
                sitemap_queue.push_back(nested);
            }
        }
        let remaining = 50_000usize.saturating_sub(report.sitemap_urls_enqueued);
        if remaining == 0 {
            break;
        }
        let requests = parsed
            .urls
            .into_iter()
            .filter(|entry| domain_allowed(&entry.url, allowed))
            .take(remaining)
            .map(|entry| AddRequest {
                url: entry.url.to_string(),
                depth: 0,
                priority: false,
                boost: seed_boost(&entry, now_ms()),
            });
        report.sitemap_urls_enqueued += frontier.enqueue_many(requests, now_ms())?;
    }
    Ok(())
}

/// Canonical anchor extraction: resolved, fragment-normalised, de-duplicated
/// `(url, anchor text)` pairs in document order. `skip_nofollow` drops
/// `rel=nofollow` anchors. Shared by the crawler and the `aphrody-web` crawl.
pub fn extract_links_opts(
    html: &str,
    page_url: &Url,
    skip_nofollow: bool,
) -> Vec<(Url, String)> {
    let dom = parse_html(html);
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for id in dom.query_selector_all("a[href]").unwrap_or_default() {
        let Some((href, nofollow)) = dom.with_node(id, |node| {
            (
                node.get_attribute("href").map(str::to_owned),
                node.get_attribute("rel").is_some_and(|rel| {
                    rel.split_ascii_whitespace().any(|part| part.eq_ignore_ascii_case("nofollow"))
                }),
            )
        }) else {
            continue;
        };
        if nofollow && skip_nofollow {
            continue;
        }
        let Some(href) = href else { continue };
        let Ok(url) = normalize_page_url(&href, Some(page_url), UrlNormalizationOptions::default())
        else {
            continue;
        };
        if seen.insert(url.as_str().to_owned()) {
            links.push((url, dom.text_content(id).chars().take(512).collect()));
        }
    }
    links
}

fn extract_links(html: &str, page_url: &Url) -> Vec<(Url, String)> {
    extract_links_opts(html, page_url, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FrontierOptions;
    use std::collections::HashMap;

    struct Fixture(HashMap<String, String>);
    impl CrawlTransport for Fixture {
        async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
            let body = self.0.get(url.as_str()).ok_or("missing fixture")?.clone();
            Ok(FetchResult {
                url: url.clone(),
                status: 200,
                content_type: Some("text/html".into()),
                body,
            })
        }
    }

    #[tokio::test]
    async fn bounded_crawl_follows_links_and_respects_host_scope() {
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        frontier.enqueue(AddRequest::seed("https://example.test/"), now_ms()).unwrap();
        let pages = HashMap::from([
            ("https://example.test/".into(), "<main><h1>Home</h1><p>A useful page with enough content for extraction.</p><a href='/next#part'>Next</a><a href='https://elsewhere.test/'>Elsewhere</a></main>".into()),
            ("https://example.test/next".into(), "<main><h1>Next</h1><p>Another useful page with different content for extraction.</p></main>".into()),
        ]);
        let options = CrawlOptions {
            allowed_domains: vec!["example.test".into()],
            ..CrawlOptions::default()
        };
        let report = crawl_bounded(&mut frontier, &Fixture(pages), &options).await.unwrap();
        assert_eq!(report.pages.len(), 2);
        assert_eq!(report.frontier.done, 2);
        assert_eq!(report.pages[0].discovered_links, 1);
    }

    #[tokio::test]
    async fn robots_and_nested_sitemaps_seed_allowed_pages() {
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        frontier.enqueue(AddRequest::seed("https://example.test/private"), now_ms()).unwrap();
        let pages = HashMap::from([
            ("https://example.test/robots.txt".into(), "User-agent: *\nDisallow: /private\nCrawl-delay: 0.001\nSitemap: /sitemap.xml".into()),
            ("https://example.test/sitemap.xml".into(), "<sitemapindex><sitemap><loc>https://example.test/more.xml</loc></sitemap></sitemapindex>".into()),
            ("https://example.test/more.xml".into(), "<urlset><url><loc>https://example.test/public</loc><priority>0.8</priority></url></urlset>".into()),
            ("https://example.test/public".into(), "<main><h1>Public</h1><p>This page is permitted and contains useful public information.</p></main>".into()),
        ]);
        let options = CrawlOptions {
            obey_robots: true,
            ingest_sitemaps: true,
            allowed_domains: vec!["example.test".into()],
            ..CrawlOptions::default()
        };
        let report = crawl_bounded(&mut frontier, &Fixture(pages), &options).await.unwrap();
        assert_eq!(report.robots_fetched, 1);
        assert_eq!(report.sitemaps_fetched, 2);
        assert_eq!(report.sitemap_urls_enqueued, 1);
        assert_eq!(report.robots_blocked, 1);
        assert_eq!(report.frontier.done, 1);
    }

    #[test]
    fn links_dedupe_fragments_and_skip_nofollow() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = "<a href='/a#one'>A</a><a href='/a#two'>A2</a><a href='/b' rel='nofollow'>B</a>";
        assert_eq!(
            extract_links(html, &base),
            vec![(Url::parse("https://example.test/a").unwrap(), "A".into())]
        );
    }

    #[tokio::test]
    async fn daemon_crawl_terminates_at_max_iterations_and_accumulates_results() {
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        frontier.enqueue(AddRequest::seed("https://daemon.test/"), now_ms()).unwrap();
        let pages = HashMap::from([
            ("https://daemon.test/".into(), "<main><h1>Daemon Home</h1><p>Daemon content is long enough to extract.</p></main>".into()),
        ]);
        let options = CrawlDaemonOptions {
            base: CrawlOptions {
                allowed_domains: vec!["daemon.test".into()],
                ..CrawlOptions::default()
            },
            max_iterations: Some(2),
            idle_poll_ms: 10,
            maintenance_interval_ms: 100,
        };
        let report = crawl_daemon(&mut frontier, &Fixture(pages), &options, None).await.unwrap();
        assert_eq!(report.pages.len(), 1);
        assert_eq!(report.frontier.done, 1);
    }
}
