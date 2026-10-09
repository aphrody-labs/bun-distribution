// SPDX-License-Identifier: Apache-2.0
//! Bounded, local HTML/CSS and linked-asset mirroring through Obscura.

use std::{
    collections::{HashSet, VecDeque},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use aphrody_web_extract::extract_main;
use futures::{StreamExt, stream::FuturesUnordered};
use obscura_dom::{NodeData, parse_html};
use obscura_net::{ObscuraHttpClient, ResourceRequest, ResourceType};
use regex::Regex;
use tokio::sync::Mutex;
use url::Url;

/// Options for one bounded static mirror run.
#[derive(Clone, Debug)]
pub struct MirrorOptions {
    pub seed_url: Url,
    pub output_dir: PathBuf,
    /// Follow same-site anchor links up to max_depth.
    pub recursive: bool,
    /// Maximum number of HTML pages, including the seed.
    pub max_pages: usize,
    /// Maximum number of linked non-HTML resources.
    pub max_assets: usize,
    /// Maximum page-link depth from the seed page.
    pub max_depth: u32,
    /// Maximum active HTTP requests.
    pub max_concurrency: usize,
    /// Minimum interval between starts of requests to the same mirror run.
    pub request_delay: Duration,
    /// Per-response decoded body cap, passed down into Obscura's transport.
    pub max_response_bytes: usize,
    /// Restricts followed page links. Assets may use separate CDN hosts.
    /// Empty means the seed host only.
    pub allowed_domains: Vec<String>,
    /// Also follow page links on common CDN/static hostnames.
    pub resolve_cdns: bool,
    /// Explicit additional page hosts enabled by the old resolve-cdns list mode.
    pub cdn_domains: Vec<String>,
    /// Public assets discovered by a structured content owner (for example
    /// Material's Carbon documents). They share this mirror's asset budget.
    pub additional_assets: Vec<Url>,
}

impl MirrorOptions {
    #[must_use]
    pub fn new(seed_url: Url, output_dir: PathBuf) -> Self {
        Self {
            seed_url,
            output_dir,
            recursive: true,
            max_pages: 100,
            max_assets: 2_000,
            max_depth: 3,
            max_concurrency: 4,
            request_delay: Duration::from_millis(500),
            max_response_bytes: 32 * 1024 * 1024,
            allowed_domains: Vec::new(),
            resolve_cdns: false,
            cdn_domains: Vec::new(),
            additional_assets: Vec::new(),
        }
    }
}

/// A file mirror failure. Partial mirrors still return their report.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MirrorFailure {
    pub url: String,
    pub error: String,
}

/// Index entry for a completed mirrored page or asset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MirrorFile {
    pub url: String,
    pub path: String,
    pub kind: String,
    pub bytes: u64,
    pub blake3: String,
    pub title: Option<String>,
}

/// Result of a bounded mirror. Files are relative to the requested output
/// directory, and failures lists fetch, HTTP-status, and write errors.
#[derive(Clone, Debug, Default)]
pub struct MirrorReport {
    pub requests: usize,
    pub pages_written: usize,
    pub assets_written: usize,
    pub bytes_written: u64,
    pub files: Vec<String>,
    pub entries: Vec<MirrorFile>,
    pub failures: Vec<MirrorFailure>,
}

/// Configuration errors which prevent a mirror from starting.
#[derive(Debug)]
pub enum MirrorError {
    InvalidSeed(String),
    InvalidBounds(String),
    Io(String),
}

impl std::fmt::Display for MirrorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSeed(message) => write!(f, "invalid mirror seed: {message}"),
            Self::InvalidBounds(message) => write!(f, "invalid mirror bounds: {message}"),
            Self::Io(message) => write!(f, "mirror output error: {message}"),
        }
    }
}

impl std::error::Error for MirrorError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JobKind {
    Page,
    Asset,
}

#[derive(Clone, Debug)]
struct MirrorJob {
    url: Url,
    depth: u32,
    kind: JobKind,
}

struct Scheduler<'a> {
    options: &'a MirrorOptions,
    queue: VecDeque<MirrorJob>,
    scheduled: HashSet<String>,
    page_count: usize,
    asset_count: usize,
    seed_host: String,
}

impl<'a> Scheduler<'a> {
    fn new(options: &'a MirrorOptions) -> Self {
        let seed_host = options.seed_url.host_str().unwrap_or_default().to_ascii_lowercase();
        Self {
            options,
            queue: VecDeque::new(),
            scheduled: HashSet::new(),
            page_count: 0,
            asset_count: 0,
            seed_host,
        }
    }

    fn enqueue(&mut self, mut url: Url, depth: u32, kind: JobKind) -> bool {
        if !valid_http_url(&url) {
            return false;
        }
        url.set_fragment(None);
        let key = url.as_str().to_owned();
        if self.scheduled.contains(&key) {
            return false;
        }
        match kind {
            JobKind::Page => {
                if self.page_count >= self.options.max_pages || !self.page_allowed(&url) {
                    return false;
                }
                self.page_count += 1;
            },
            JobKind::Asset => {
                if self.asset_count >= self.options.max_assets {
                    return false;
                }
                self.asset_count += 1;
            },
        }
        self.scheduled.insert(key);
        self.queue.push_back(MirrorJob { url, depth, kind });
        true
    }

    fn page_allowed(&self, url: &Url) -> bool {
        let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
            return false;
        };
        let in_allowed = if self.options.allowed_domains.is_empty() {
            host == self.seed_host
        } else {
            self.options.allowed_domains.iter().any(|domain| {
                let domain = domain.to_ascii_lowercase();
                host == domain || host.ends_with(&format!(".{domain}"))
            })
        };
        in_allowed
            || self.options.cdn_domains.iter().any(|domain| host.eq_ignore_ascii_case(domain))
            || (self.options.resolve_cdns && is_common_cdn_host(&host))
    }
}

/// Download the seed page, recursively followed HTML pages, CSS, and linked
/// static resources into output_dir.
///
/// Page links are restricted to allowed_domains (the seed host by default).
/// Asset URLs may point at CDN hosts but are constrained by Obscura network
/// policy and the independent max_assets bound.
pub async fn mirror_site(
    client: &ObscuraHttpClient,
    options: &MirrorOptions,
) -> Result<MirrorReport, MirrorError> {
    validate_options(options)?;
    tokio::fs::create_dir_all(&options.output_dir)
        .await
        .map_err(|error| MirrorError::Io(error.to_string()))?;

    let mut scheduler = Scheduler::new(options);
    scheduler.enqueue(options.seed_url.clone(), 0, JobKind::Page);
    for asset in &options.additional_assets {
        scheduler.enqueue(asset.clone(), 0, JobKind::Asset);
    }
    let mut report = MirrorReport::default();
    let concurrency = options.max_concurrency.clamp(1, MAX_CONCURRENCY);
    let pacer = Arc::new(Mutex::new(None::<Instant>));
    let mut active = FuturesUnordered::new();

    while !scheduler.queue.is_empty() || !active.is_empty() {
        while active.len() < concurrency {
            let Some(job) = scheduler.queue.pop_front() else { break };
            let pacer = Arc::clone(&pacer);
            let delay = options.request_delay;
            active.push(async move {
                pace_request(&pacer, delay).await;
                let request = match job.kind {
                    JobKind::Page => ResourceRequest::navigation()
                        .with_max_response_bytes(options.max_response_bytes),
                    JobKind::Asset => ResourceRequest::subresource(ResourceType::Other, &job.url)
                        .with_max_response_bytes(options.max_response_bytes),
                };
                let response = client.fetch_resource_with_callbacks(&job.url, request, None).await;
                (job, response)
            });
        }

        let Some((job, result)) = active.next().await else { break };
        report.requests += 1;
        let response = match result {
            Ok(response) if (200..400).contains(&response.status) => response,
            Ok(response) => {
                report.failures.push(MirrorFailure {
                    url: job.url.to_string(),
                    error: format!("HTTP {}", response.status),
                });
                continue;
            },
            Err(error) => {
                report
                    .failures
                    .push(MirrorFailure { url: job.url.to_string(), error: error.to_string() });
                continue;
            },
        };

        if !valid_http_url(&response.url)
            || (job.kind == JobKind::Page && !scheduler.page_allowed(&response.url))
        {
            report.failures.push(MirrorFailure {
                url: job.url.to_string(),
                error: "redirect target is outside the allowed mirror scope".into(),
            });
            continue;
        }

        let content_type = response.content_type().unwrap_or_default().to_ascii_lowercase();
        let is_html = content_type.contains("text/html")
            || (content_type.is_empty()
                && (job.kind == JobKind::Page || looks_like_html(&response.body)));
        let is_css = content_type.contains("text/css")
            || (content_type.is_empty()
                && response.url.path().to_ascii_lowercase().ends_with(".css"));

        let (relative_path, bytes, title) = if is_html {
            let source = response.text();
            let title = extract_main(&source, Some(response.url.as_str())).title;
            let rewritten =
                rewrite_html(&source, &response.url, job.depth, options, &mut scheduler);
            (local_relative_path(&response.url, true), rewritten.into_bytes(), Some(title))
        } else if is_css {
            let source = response.text();
            let rewritten = rewrite_css(&source, &response.url, job.depth, &mut scheduler);
            (local_relative_path(&response.url, false), rewritten.into_bytes(), None)
        } else {
            (local_relative_path(&response.url, job.kind == JobKind::Page), response.body, None)
        };

        let destination = options.output_dir.join(&relative_path);
        let write_result = safe_write(&options.output_dir, &relative_path, &bytes).await;
        match write_result {
            Ok(()) => {
                report.bytes_written = report.bytes_written.saturating_add(bytes.len() as u64);
                if is_html {
                    report.pages_written += 1;
                } else {
                    report.assets_written += 1;
                }
                let path = relative_path.to_string_lossy().replace('\\', "/");
                report.files.push(path.clone());
                report.entries.push(MirrorFile {
                    url: response.url.to_string(),
                    path,
                    kind: if is_html {
                        "html"
                    } else if is_css {
                        "css"
                    } else {
                        "asset"
                    }
                    .into(),
                    bytes: bytes.len() as u64,
                    blake3: blake3::hash(&bytes).to_hex().to_string(),
                    title: title.filter(|title| !title.trim().is_empty()),
                });
            },
            Err(error) => report.failures.push(MirrorFailure {
                url: response.url.to_string(),
                error: format!("write {}: {error}", destination.display()),
            }),
        }
    }

    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "seedUrl": options.seed_url,
        "summary": {
            "requests": report.requests,
            "pagesWritten": report.pages_written,
            "assetsWritten": report.assets_written,
            "bytesWritten": report.bytes_written,
        },
        "files": report.entries.iter().map(|entry| serde_json::json!({
            "url": entry.url,
            "path": entry.path,
            "kind": entry.kind,
            "bytes": entry.bytes,
            "blake3": entry.blake3,
            "title": entry.title,
        })).collect::<Vec<_>>(),
        "failures": report.failures.iter().map(|failure| serde_json::json!({
            "url": failure.url,
            "error": failure.error,
        })).collect::<Vec<_>>(),
    });
    let manifest_bytes =
        serde_json::to_vec_pretty(&manifest).map_err(|error| MirrorError::Io(error.to_string()))?;
    match safe_write(&options.output_dir, Path::new("manifest.json"), &manifest_bytes).await {
        Ok(()) => report.files.push("manifest.json".into()),
        Err(error) => report.failures.push(MirrorFailure {
            url: options.seed_url.to_string(),
            error: format!("write mirror manifest: {error}"),
        }),
    }
    Ok(report)
}

const MAX_PAGES: usize = 10_000;
const MAX_ASSETS: usize = 20_000;
const MAX_CONCURRENCY: usize = 64;

fn validate_options(options: &MirrorOptions) -> Result<(), MirrorError> {
    if !valid_http_url(&options.seed_url) {
        return Err(MirrorError::InvalidSeed(
            "only credential-free HTTP(S) URLs are accepted".into(),
        ));
    }
    if options.output_dir.as_os_str().is_empty() {
        return Err(MirrorError::InvalidSeed("output directory is empty".into()));
    }
    if options.max_pages == 0 || options.max_pages > MAX_PAGES {
        return Err(MirrorError::InvalidBounds(format!("max_pages must be 1..={MAX_PAGES}")));
    }
    if options.max_assets > MAX_ASSETS {
        return Err(MirrorError::InvalidBounds(format!("max_assets must be <= {MAX_ASSETS}")));
    }
    if options.additional_assets.len() > MAX_ASSETS
        || options.additional_assets.iter().any(|url| !valid_http_url(url))
    {
        return Err(MirrorError::InvalidBounds(
            "additional_assets must be bounded credential-free HTTP(S) URLs".into(),
        ));
    }
    if options.max_response_bytes == 0 || options.max_response_bytes > 128 * 1024 * 1024 {
        return Err(MirrorError::InvalidBounds("max_response_bytes must be 1..=134217728".into()));
    }
    if options.allowed_domains.iter().any(|domain| {
        domain.trim().is_empty()
            || domain.contains('/')
            || domain.contains('@')
            || domain.contains(':')
    }) {
        return Err(MirrorError::InvalidBounds(
            "allowed_domains must contain host names without schemes or ports".into(),
        ));
    }
    if options.cdn_domains.iter().any(|domain| {
        domain.trim().is_empty()
            || domain.contains('/')
            || domain.contains('@')
            || domain.contains(':')
    }) {
        return Err(MirrorError::InvalidBounds(
            "cdn_domains must contain host names without schemes or ports".into(),
        ));
    }
    Ok(())
}

fn is_common_cdn_host(host: &str) -> bool {
    ["cdn", "static", "assets", "cloudfront", "google", "googleapis"]
        .iter()
        .any(|marker| host.contains(marker))
}

pub(crate) async fn safe_write(
    root: &Path,
    relative_path: &Path,
    bytes: &[u8],
) -> std::io::Result<()> {
    let canonical_root = tokio::fs::canonicalize(root).await?;
    let mut parent = canonical_root.clone();
    let components = relative_path.components().collect::<Vec<_>>();
    let (filename, directories) = components.split_last().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "empty mirror path")
    })?;
    for component in directories {
        let Component::Normal(name) = component else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "unsafe mirror path",
            ));
        };
        parent.push(name);
        match tokio::fs::symlink_metadata(&parent).await {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("refusing symlinked mirror directory {}", parent.display()),
                ));
            },
            Ok(metadata) if !metadata.is_dir() => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("mirror parent is not a directory: {}", parent.display()),
                ));
            },
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                tokio::fs::create_dir(&parent).await?;
            },
            Err(error) => return Err(error),
        }
    }
    let Component::Normal(filename) = filename else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "unsafe mirror filename",
        ));
    };
    let destination = parent.join(filename);
    if let Ok(metadata) = tokio::fs::symlink_metadata(&destination).await
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("refusing non-regular mirror destination {}", destination.display()),
        ));
    }
    tokio::fs::write(destination, bytes).await
}

fn valid_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

async fn pace_request(pacer: &Mutex<Option<Instant>>, delay: Duration) {
    if delay.is_zero() {
        return;
    }
    let mut last = pacer.lock().await;
    if let Some(previous) = *last {
        let elapsed = previous.elapsed();
        if elapsed < delay {
            tokio::time::sleep(delay - elapsed).await;
        }
    }
    *last = Some(Instant::now());
}

fn looks_like_html(body: &[u8]) -> bool {
    let sample = String::from_utf8_lossy(&body[..body.len().min(512)]).to_ascii_lowercase();
    sample.contains("<!doctype html") || sample.contains("<html") || sample.contains("<body")
}

fn rewrite_html(
    html: &str,
    page_url: &Url,
    depth: u32,
    options: &MirrorOptions,
    scheduler: &mut Scheduler<'_>,
) -> String {
    let tree = parse_html(html);
    let nodes = tree.descendants(tree.document());
    for id in nodes {
        let Some((tag, attributes, text, parent)) = tree.with_node(id, |node| {
            let tag = node.as_element().map(|name| name.local.to_string());
            let attrs = node
                .attrs()
                .map(|attrs| {
                    attrs
                        .iter()
                        .map(|attr| (attr.qualified_name(), attr.value.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let text = match &node.data {
                NodeData::Text { contents } => Some(contents.clone()),
                _ => None,
            };
            (tag, attrs, text, node.parent)
        }) else {
            continue;
        };

        let Some(tag) = tag else {
            if let Some(text) = text {
                let in_style = parent
                    .and_then(|parent| {
                        tree.with_node(parent, |node| {
                            node.as_element().is_some_and(|name| (&*name.local) == "style")
                        })
                    })
                    .unwrap_or(false);
                if in_style {
                    let rewritten = rewrite_css(&text, page_url, depth, scheduler);
                    tree.with_node_mut(id, |node| {
                        if let NodeData::Text { contents } = &mut node.data {
                            *contents = rewritten;
                        }
                    });
                }
            }
            continue;
        };

        let link_resource = tag == "link"
            && attributes.iter().any(|(attr, _)| {
                attr.eq_ignore_ascii_case("href")
                    && attributes.iter().any(|(rel_attr, rel_value)| {
                        rel_attr.eq_ignore_ascii_case("rel")
                            && rel_value.split_ascii_whitespace().any(|rel| {
                                matches!(
                                    rel.to_ascii_lowercase().as_str(),
                                    "stylesheet"
                                        | "icon"
                                        | "shortcut"
                                        | "manifest"
                                        | "preload"
                                        | "modulepreload"
                                        | "apple-touch-icon"
                                )
                            })
                    })
            });
        let mut changed = Vec::<(String, String)>::new();
        for (name, value) in attributes {
            let lower_name = name.to_ascii_lowercase();
            if lower_name == "style" {
                changed.push((name, rewrite_css(&value, page_url, depth, scheduler)));
                continue;
            }
            if lower_name == "srcset" || lower_name == "imagesrcset" {
                changed.push((name, rewrite_srcset(&value, page_url, depth, scheduler)));
                continue;
            }

            let is_anchor = (tag == "a" || tag == "area") && lower_name == "href";
            let is_resource = matches!(
                lower_name.as_str(),
                "src" | "poster" | "data-src" | "data-lazy-src" | "xlink:href" | "data"
            ) || (link_resource && lower_name == "href");
            if !is_anchor && !is_resource {
                continue;
            }
            let Some(target) = resolve_url(page_url, &value) else { continue };
            if is_anchor {
                if options.recursive && depth < options.max_depth {
                    let local = scheduler.enqueue(target.clone(), depth + 1, JobKind::Page);
                    if local || scheduler.scheduled.contains(target.as_str()) {
                        let path = local_relative_path(&target, true);
                        changed.push((
                            name,
                            relative_link(&local_relative_path(page_url, true), &path),
                        ));
                    }
                }
            } else if let Some(rewritten) =
                schedule_asset_and_rewrite(&target, page_url, depth, scheduler)
            {
                changed.push((name, rewritten));
            }
        }
        for (name, value) in changed {
            tree.with_node_mut(id, |node| {
                if let Some(attrs) = node.attrs_mut()
                    && let Some(attr) = attrs.iter_mut().find(|attr| attr.qualified_name_eq(&name))
                {
                    attr.value = value;
                }
            });
        }
    }
    tree.outer_html(tree.document())
}

fn rewrite_srcset(
    value: &str,
    page_url: &Url,
    depth: u32,
    scheduler: &mut Scheduler<'_>,
) -> String {
    if value.to_ascii_lowercase().contains("data:") {
        return value.to_owned();
    }
    value
        .split(',')
        .map(|candidate| {
            let mut parts = candidate.split_whitespace();
            let Some(raw_url) = parts.next() else { return candidate.trim().to_owned() };
            let Some(target) = resolve_url(page_url, raw_url) else {
                return candidate.trim().to_owned();
            };
            let Some(rewritten) = schedule_asset_and_rewrite(&target, page_url, depth, scheduler)
            else {
                return candidate.trim().to_owned();
            };
            std::iter::once(rewritten).chain(parts.map(str::to_owned)).collect::<Vec<_>>().join(" ")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn schedule_asset_and_rewrite(
    target: &Url,
    from_url: &Url,
    depth: u32,
    scheduler: &mut Scheduler<'_>,
) -> Option<String> {
    let normalized = without_fragment(target.clone());
    let scheduled = scheduler.enqueue(normalized.clone(), depth, JobKind::Asset);
    if !scheduled && !scheduler.scheduled.contains(normalized.as_str()) {
        return None;
    }
    let from = local_relative_path(from_url, true);
    let to = local_relative_path(&normalized, false);
    Some(relative_link(&from, &to))
}

fn rewrite_css(
    css: &str,
    stylesheet_url: &Url,
    depth: u32,
    scheduler: &mut Scheduler<'_>,
) -> String {
    let mut replacements = Vec::<(std::ops::Range<usize>, String)>::new();
    for captures in css_url_regex().captures_iter(css) {
        let Some(full) = captures.get(0) else { continue };
        let Some(inner) = captures.get(1) else { continue };
        let raw = inner.as_str().trim().trim_matches(['\'', '"']).trim();
        if raw.is_empty() || raw.starts_with("data:") || raw.starts_with('#') {
            continue;
        }
        let Some(target) = resolve_url(stylesheet_url, raw) else { continue };
        let Some(rewritten) = schedule_asset_and_rewrite(&target, stylesheet_url, depth, scheduler)
        else {
            continue;
        };
        replacements.push((full.start()..full.end(), format!("url(\"{rewritten}\")")));
    }
    for captures in css_import_regex().captures_iter(css) {
        let Some(full) = captures.get(0) else { continue };
        let Some(target_capture) = captures.get(1) else { continue };
        let raw = target_capture.as_str().trim();
        let Some(target) = resolve_url(stylesheet_url, raw) else { continue };
        let Some(rewritten) = schedule_asset_and_rewrite(&target, stylesheet_url, depth, scheduler)
        else {
            continue;
        };
        replacements.push((full.start()..full.end(), format!("@import \"{rewritten}\"")));
    }
    replacements.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
    let mut output = css.to_owned();
    for (range, replacement) in replacements {
        output.replace_range(range, &replacement);
    }
    output
}

fn css_url_regex() -> &'static Regex {
    static REGEX: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?is)url\(\s*([^)]*?)\s*\)").expect("constant CSS regex"))
}

fn css_import_regex() -> &'static Regex {
    static REGEX: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?is)@import\s+["']([^"']+)["']"#).expect("constant CSS import regex")
    })
}

fn resolve_url(base: &Url, raw: &str) -> Option<Url> {
    let raw = raw.trim();
    if raw.is_empty()
        || raw.starts_with('#')
        || raw.starts_with("data:")
        || raw.starts_with("javascript:")
    {
        return None;
    }
    let mut url = base.join(raw).ok()?;
    if !valid_http_url(&url) {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

fn without_fragment(mut url: Url) -> Url {
    url.set_fragment(None);
    url
}

pub(crate) fn local_relative_path(url: &Url, page: bool) -> PathBuf {
    let mut path = PathBuf::new();
    path.push(safe_component(url.host_str().unwrap_or("unknown-host")));
    if let Some(port) = url.port() {
        path.push(format!("port-{port}"));
    }
    let segments = url.path_segments().into_iter().flatten().collect::<Vec<_>>();
    let non_empty = segments.iter().filter(|segment| !segment.is_empty()).collect::<Vec<_>>();
    for segment in &non_empty {
        path.push(safe_component(segment));
    }
    let ends_in_slash = url.path().ends_with('/');
    if non_empty.is_empty() || ends_in_slash {
        path.push("index.html");
    } else if let Some(filename) = non_empty.last() {
        let filename = safe_component(filename);
        let ext = Path::new(&filename).extension().and_then(|value| value.to_str()).unwrap_or("");
        if ext.is_empty() {
            path.push("index.html");
        } else if page
            && matches!(ext.to_ascii_lowercase().as_str(), "php" | "asp" | "aspx" | "jsp")
        {
            path.set_file_name(format!("{filename}.html"));
        }
    }

    if let Some(query) = url.query() {
        let hash = blake3::hash(query.as_bytes()).to_hex().to_string();
        let filename = path.file_name().and_then(|name| name.to_str()).unwrap_or("index.html");
        let (stem, extension) = filename.rsplit_once('.').unwrap_or((filename, ""));
        let decorated = if extension.is_empty() {
            format!("{stem}.q-{}", &hash[..10])
        } else {
            format!("{stem}.q-{}.{}", &hash[..10], extension)
        };
        path.set_file_name(decorated);
    }
    path
}

fn safe_component(raw: &str) -> String {
    // Decode encoded path bytes before sanitizing so browser links and files
    // agree, while preventing encoded separators from escaping a path segment.
    let encoded = raw.replace('+', "%2B");
    let value = url::form_urlencoded::parse(format!("v={encoded}").as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| raw.to_owned());
    let mut component = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if component.is_empty() || component == "." || component == ".." {
        component = "_".into();
    }
    let changed = component != value || component.len() > 120;
    if changed {
        let hash = blake3::hash(raw.as_bytes()).to_hex().to_string();
        let suffix = format!(".h{}", &hash[..10]);
        let (stem, extension) = component.rsplit_once('.').unwrap_or((&component, ""));
        let extension_suffix =
            if extension.is_empty() { String::new() } else { format!(".{extension}") };
        let stem_limit = 120usize.saturating_sub(suffix.len() + extension_suffix.len());
        let mut truncated_stem = String::new();
        for character in stem.chars() {
            if truncated_stem.len() + character.len_utf8() > stem_limit {
                break;
            }
            truncated_stem.push(character);
        }
        component = format!("{truncated_stem}{suffix}{extension_suffix}");
    }
    if is_windows_reserved_name(&component) {
        component.insert(0, '_');
    }
    component
}

fn is_windows_reserved_name(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or_default().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

fn relative_link(from_file: &Path, target_file: &Path) -> String {
    let from_parent = from_file.parent().unwrap_or_else(|| Path::new(""));
    let from = from_parent.components().collect::<Vec<_>>();
    let target = target_file.components().collect::<Vec<_>>();
    let common = from.iter().zip(&target).take_while(|(left, right)| left == right).count();
    let mut parts = vec!["..".to_owned(); from.len().saturating_sub(common)];
    parts.extend(target.iter().skip(common).filter_map(|component| match component {
        Component::Normal(value) => value.to_str().map(str::to_owned),
        _ => None,
    }));
    if parts.is_empty() { "./".into() } else { parts.join("/") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn additional_assets_share_the_existing_asset_budget_and_deduplicate() {
        let mut options = MirrorOptions::new(
            Url::parse("https://example.org/").unwrap(),
            PathBuf::from("mirror"),
        );
        options.max_assets = 1;
        options.additional_assets = vec![
            Url::parse("https://cdn.example/one.png").unwrap(),
            Url::parse("https://cdn.example/two.png").unwrap(),
        ];
        assert!(validate_options(&options).is_ok());
        let mut scheduler = Scheduler::new(&options);
        assert!(scheduler.enqueue(options.seed_url.clone(), 0, JobKind::Page));
        assert!(scheduler.enqueue(options.additional_assets[0].clone(), 0, JobKind::Asset));
        assert!(!scheduler.enqueue(options.additional_assets[0].clone(), 0, JobKind::Asset));
        assert!(!scheduler.enqueue(options.additional_assets[1].clone(), 0, JobKind::Asset));
        assert_eq!(scheduler.asset_count, 1);
        assert_eq!(scheduler.page_count, 1);
        options.additional_assets =
            vec![Url::parse("https://user:password@cdn.example/one.png").unwrap()];
        assert!(validate_options(&options).is_err());
    }

    #[test]
    fn mirror_paths_are_host_scoped_and_query_sensitive() {
        let one = Url::parse("https://media.example/a%20b.css?v=1").unwrap();
        let two = Url::parse("https://media.example/a%20b.css?v=2").unwrap();
        let path_one = local_relative_path(&one, false);
        let path_two = local_relative_path(&two, false);
        assert_ne!(path_one, path_two);
        assert!(path_one.starts_with("media.example"));
        assert!(path_one.to_string_lossy().contains("a_b.h"));
        assert!(path_one.to_string_lossy().ends_with(".css"));
    }

    #[test]
    fn relative_link_stays_inside_local_mirror_root() {
        let from = Path::new("example.org/docs/index.html");
        let target = Path::new("example.org/assets/site.css");
        assert_eq!(relative_link(from, target), "../assets/site.css");
    }

    #[test]
    fn mirror_html_rewrites_assets_and_follows_only_allowed_page_links() {
        let seed = Url::parse("https://example.org/start/").unwrap();
        let mut options = MirrorOptions::new(seed.clone(), PathBuf::from("mirror"));
        options.max_pages = 3;
        options.max_assets = 3;
        let mut scheduler = Scheduler::new(&options);
        scheduler.enqueue(seed.clone(), 0, JobKind::Page);
        let html = r#"<html><body><a href="/next/">next</a><img src="/img/a.png"><a href="https://elsewhere.test/page">outside</a></body></html>"#;
        let output = rewrite_html(html, &seed, 0, &options, &mut scheduler);
        assert!(output.contains("<img src=\"../img/a.png\">"));
        assert!(output.contains("href=\"../next/index.html\""));
        assert!(output.contains("https://elsewhere.test/page"));
        assert_eq!(scheduler.page_count, 2);
        assert_eq!(scheduler.asset_count, 1);
    }

    #[test]
    fn common_cdn_page_hosts_are_opt_in_and_explicit_hosts_are_exact() {
        let seed = Url::parse("https://wiki.example.org/start/").unwrap();
        let cdn = Url::parse("https://static.example-cdn.test/docs/").unwrap();
        let unrelated = Url::parse("https://other.test/docs/").unwrap();
        let mut options = MirrorOptions::new(seed.clone(), PathBuf::from("mirror"));
        let scheduler = Scheduler::new(&options);
        assert!(!scheduler.page_allowed(&cdn));
        options.resolve_cdns = true;
        let scheduler = Scheduler::new(&options);
        assert!(scheduler.page_allowed(&cdn));
        assert!(!scheduler.page_allowed(&unrelated));
        options.resolve_cdns = false;
        options.cdn_domains = vec!["other.test".into()];
        let scheduler = Scheduler::new(&options);
        assert!(scheduler.page_allowed(&unrelated));
        assert!(!scheduler.page_allowed(&Url::parse("https://sub.other.test/docs/").unwrap()));
    }
}
