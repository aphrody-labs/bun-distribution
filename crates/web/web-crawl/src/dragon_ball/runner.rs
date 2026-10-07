// SPDX-License-Identifier: Apache-2.0
//! Persistent native Dragon Ball campaigns. Captures are checkpointed before the
//! shared frontier marks pages done; export/index can recover after interruption.
use super::catalogue::EDITIONS;
use super::documents::write_private;
use super::{
    Catalogue, Collection, DragonBallDocument, DragonBallPlan, DragonBallTarget, EpisodeSynopsis,
    Gallery, JumpStatistic, Plate, materialize_documents, parse_collection, parse_gallery,
    parse_jump_statistics, parse_miscellaneous, parse_official_articles, parse_plate_inventory,
    parse_toei_episodes, project_document, sha256, validate_source_url,
};
use crate::{
    AddRequest, CrawlOptions, CrawlTransport, FetchResult, Frontier, FrontierOptions, crawl_bounded,
};
use aphrody_web_extract::{extract_main, html_to_markdown};
use obscura_dom::parse_html;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Clone, Debug)]
pub struct DragonBallRunOptions {
    pub output: PathBuf,
    pub sources: Vec<String>,
    /// Global page/network budget shared by every selected source.
    pub max_requests: Option<usize>,
    pub max_depth: Option<u32>,
    pub with_gallery: bool,
    pub force: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct TargetReport {
    pub id: String,
    pub attempts: usize,
    pub documents: usize,
    pub pending: u64,
    pub locked: u64,
    pub failed: u64,
    pub completed: bool,
    pub errors: Vec<(String, String)>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DragonBallRunReport {
    pub schema: String,
    pub completed: bool,
    pub output: PathBuf,
    pub documents_dir: PathBuf,
    pub documents: usize,
    pub network_requests: usize,
    pub targets: Vec<TargetReport>,
    pub errors: Vec<(String, String)>,
    pub catalogue: Option<PathBuf>,
    pub projection: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Capture {
    #[serde(default)]
    raw_html: String,
    document: DragonBallDocument,
    collection: Option<Collection>,
    gallery: Option<(String, Gallery)>,
    plates: Vec<Plate>,
    episodes: Vec<EpisodeSynopsis>,
    jump_statistics: Vec<JumpStatistic>,
    public_json: Option<Value>,
}

struct Budget<'a, T> {
    inner: &'a T,
    requests: Cell<usize>,
    limit: usize,
}
impl<T: CrawlTransport> CrawlTransport for Budget<'_, T> {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
        validate_source_url(url.as_str())?;
        if self.requests.get() >= self.limit {
            return Err("Dragon Ball global request budget exhausted".into());
        }
        self.requests.set(self.requests.get() + 1);
        let response = self.inner.fetch(url).await?;
        validate_source_url(response.url.as_str())?;
        Ok(response)
    }
}

struct CaptureTransport<'a, T> {
    inner: &'a T,
    target: &'a DragonBallTarget,
    directory: PathBuf,
}
impl<T: CrawlTransport> CrawlTransport for CaptureTransport<'_, T> {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
        let response = self.inner.fetch(url).await?;
        // Control documents are consumed by their existing owners, never indexed as prose.
        if url.path().ends_with("robots.txt") || url.path().ends_with(".xml") {
            return Ok(response);
        }
        if !self.target.accepts(&response.url) {
            return Err("redirect left Dragon Ball target scope".into());
        }
        if !(200..300).contains(&response.status) {
            return Ok(response);
        }
        let dom = parse_html(&response.body);
        let title = super::structured::text(&dom, "title").unwrap_or_default();
        if title.starts_with("Just a moment")
            || title.starts_with("Attention Required")
            || title.starts_with("Un instant")
        {
            return Err("source returned a challenge page; capture withheld".into());
        }
        let clean = clean_source_html(&response.body, &response.url);
        let extracted = extract_main(&clean, Some(response.url.as_str()));
        let public_json =
            if response.content_type.as_deref().is_some_and(|kind| kind.contains("json"))
                || matches!(self.target.mode.as_str(), "json" | "shenron_api")
            {
                Some(
                    serde_json::from_str::<Value>(&response.body)
                        .map_err(|error| format!("invalid source JSON: {error}"))?,
                )
            } else {
                None
            };
        let markdown = if let Some(value) = &public_json {
            format!(
                "```json\n{}\n```",
                serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
            )
        } else if extracted.markdown.trim().is_empty() {
            html_to_markdown(&clean, Some(response.url.as_str()))
        } else {
            extracted.markdown.clone()
        };
        let provenance = json!({"title":extracted.title,"publicationDate":extracted.published,"author":extracted.byline,"targetId":self.target.id,"sourceRefs":self.target.source_refs,"lang":self.target.lang,"kind":self.target.kind,"fetchedUrl":response.url,"owner":"aphrody-web-crawl/dragon-ball"});
        let document = project_document(
            &response.url,
            response.status,
            &response.body,
            &markdown,
            &provenance,
            &chrono::Utc::now().to_rfc3339(),
        )?;
        let is_cn = response.url.host_str() == Some("comic.dragonballcn.com");
        let collection = if is_cn && !response.url.path().ends_with("gain_1.php") {
            let slug = response.url.path().trim_matches('/').trim_end_matches(".htm");
            let mut collection = parse_collection(
                &response.body,
                if slug.is_empty() { "divers" } else { slug },
                &response.url,
            );
            let metadata = parse_miscellaneous(&response.body, &response.url);
            for publication in &mut collection.publications {
                if let Some(extra) = metadata.get(&publication.did) {
                    publication.section = extra.section.clone();
                    publication.section_icon = extra.section_icon.clone();
                    publication.display_date = extra.display_date.clone();
                    publication.publication_date = extra.publication_date.clone();
                    publication.scanned_date = extra.scanned_date.clone();
                    publication.forum_thread = extra.forum_thread.clone();
                }
            }
            Some(collection)
        } else {
            None
        };
        let gallery = if is_cn && response.url.path().ends_with("gain_1.php") {
            response
                .url
                .query_pairs()
                .find(|(key, _)| key == "did")
                .map(|(_, value)| {
                    (value.into_owned(), parse_gallery(&response.body, "", &response.url))
                })
                .map(|(did, _)| {
                    let gallery = parse_gallery(&response.body, &did, &response.url);
                    (did, gallery)
                })
        } else {
            None
        };
        let capture = Capture {
            raw_html: response.body.clone(),
            document,
            collection,
            gallery,
            plates: if is_cn { parse_plate_inventory(&markdown) } else { Vec::new() },
            episodes: parse_toei_episodes(&response.body, &response.url),
            jump_statistics: if response.url.host_str() == Some("www.jajanken.net") {
                parse_jump_statistics(&response.body)
            } else {
                Vec::new()
            },
            public_json,
        };
        write_private(
            &self.directory.join(format!("{}.json", sha256(response.url.as_str()))),
            serde_json::to_vec(&capture).map_err(|error| error.to_string())?.as_slice(),
        )?;
        Ok(response)
    }
}

fn clean_source_html(html: &str, url: &Url) -> String {
    let dom = parse_html(html);
    for id in dom
        .query_selector_all("#wm-ipp, #wm-ipp-base, #wm-ipp-print, script, style, nav, footer")
        .unwrap_or_default()
    {
        dom.remove(id);
    }
    if url.host_str().is_some_and(|host| host.ends_with("neoseeker.com")) {
        let posts =
            dom.query_selector_all(".postContent, .message, .post-content").unwrap_or_default();
        if !posts.is_empty() {
            return posts.into_iter().map(|id| dom.outer_html(id)).collect::<Vec<_>>().join("\n");
        }
    }
    if url.host_str() == Some("www.kanzenshuu.com")
        && let Some(id) = dom.query_selector("#trans-content, main#content, main").ok().flatten()
    {
        return dom.outer_html(id);
    }
    dom.outer_html(dom.document())
}

fn read_captures(directory: &Path) -> Result<Vec<Capture>, String> {
    let mut captures = Vec::new();
    if !directory.exists() {
        return Ok(captures);
    }
    let mut paths = std::fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    paths.sort();
    for path in paths {
        if path.extension().is_some_and(|ext| ext == "json") {
            captures.push(
                serde_json::from_slice(&std::fs::read(&path).map_err(|error| error.to_string())?)
                    .map_err(|error| format!("{}: {error}", path.display()))?,
            );
        }
    }
    Ok(captures)
}

fn enqueue(frontier: &mut Frontier, url: &str, force: bool) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    let seed = AddRequest::seed(url);
    if force {
        frontier.enqueue_or_refresh(seed, now)
    } else {
        frontier.enqueue(seed, now).map(|_| ())
    }
    .map_err(|error| error.to_string())
}

async fn resolve_wayback<T: CrawlTransport>(
    target: &mut DragonBallTarget,
    transport: &T,
) -> Result<Vec<(String, String)>, String> {
    let mut snapshots = Vec::new();
    let mut errors = Vec::new();
    for seed in &target.seeds {
        let mut url =
            Url::parse("https://archive.org/wayback/available").expect("static Wayback origin");
        url.query_pairs_mut().append_pair("url", seed);
        let response = match transport.fetch(&url).await {
            Ok(response) => response,
            Err(error) => {
                errors.push((seed.clone(), error));
                continue;
            },
        };
        if !(200..300).contains(&response.status) {
            errors.push((seed.clone(), format!("Wayback resolver HTTP {}", response.status)));
            continue;
        }
        let value: Value =
            serde_json::from_str(&response.body).map_err(|error| error.to_string())?;
        let Some(snapshot) =
            value.pointer("/archived_snapshots/closest/url").and_then(Value::as_str)
        else {
            errors.push((seed.clone(), "no Wayback snapshot available".into()));
            continue;
        };
        let snapshot = validate_source_url(snapshot)?;
        if snapshot.host_str() != Some("web.archive.org") {
            return Err("Wayback resolver returned outside archive origin".into());
        }
        snapshots.push(snapshot.to_string());
    }
    target.seeds = snapshots;
    target.allowed_domains = vec!["web.archive.org".into()];
    target.include_patterns = vec![
        r"^https?://web\.archive\.org/web/[^/]+/https?://(?:www\.)?neoseeker\.com/forums/88/"
            .into(),
    ];
    target.max_depth = Some(1);
    Ok(errors)
}

/// Execute a complete selected campaign through Web's existing transport and
/// persistent scheduler. All selected sources share one network request budget.
pub async fn run_dragon_ball<T: CrawlTransport>(
    plan: &DragonBallPlan,
    options: &DragonBallRunOptions,
    transport: &T,
) -> Result<DragonBallRunReport, String> {
    plan.validate()?;
    for id in &options.sources {
        if !plan.targets.iter().any(|target| target.id == *id && target.enabled) {
            return Err(format!("unknown or disabled Dragon Ball source: {id}"));
        }
    }
    std::fs::create_dir_all(&options.output).map_err(|error| error.to_string())?;
    let limit = options.max_requests.unwrap_or(plan.defaults.max_pages);
    let budget = Budget { inner: transport, requests: Cell::new(0), limit };
    let mut report = DragonBallRunReport {
        schema: "aphrody-dragon-ball-crawl/v1".into(),
        completed: false,
        output: options.output.clone(),
        documents_dir: options.output.join("documents"),
        documents: 0,
        network_requests: 0,
        targets: Vec::new(),
        errors: Vec::new(),
        catalogue: None,
        projection: options.output.join("shenron-documents.jsonl"),
    };
    let mut all_documents = BTreeMap::new();
    let mut all_captures = Vec::new();
    for original in plan.targets.iter().filter(|target| {
        target.enabled && (options.sources.is_empty() || options.sources.contains(&target.id))
    }) {
        let mut target = original.clone();
        let mut target_report = TargetReport { id: target.id.clone(), ..TargetReport::default() };
        if target.mode == "wayback" {
            target_report.errors.extend(resolve_wayback(&mut target, &budget).await?);
        }
        let directory = options.output.join("captures").join(&target.id);
        if target.mode == "mediawiki" {
            let seed = validate_source_url(&target.seeds[0])?;
            let root =
                seed.path().rfind("/wiki/").ok_or("MediaWiki seed must contain /wiki/<title>")?;
            let installation = &seed.path()[..root];
            let api =
                seed.join(&format!("{installation}/api.php")).map_err(|error| error.to_string())?;
            let mut wiki = crate::MediaWikiOptions::new(api);
            wiki.article_path = format!("{installation}/wiki/$1");
            wiki.include_url_regex = target.include_patterns.clone();
            wiki.exclude_url_regex = target.exclude_patterns.clone();
            wiki.max_pages = limit.saturating_sub(budget.requests.get()) / 2;
            wiki.request_interval = std::time::Duration::from_millis(
                target.per_host_delay_ms.unwrap_or(plan.defaults.per_host_delay_ms),
            );
            let before = budget.requests.get();
            match crate::crawl_mediawiki_with_transport(&budget, &wiki).await {
                Ok(pages) => {
                    target_report.completed = pages.len() < wiki.max_pages && wiki.max_pages > 0;
                    for page in pages {
                        if !target.accepts(&page.url) {
                            continue;
                        }
                        let document = project_document(
                            &page.url,
                            200,
                            "",
                            &page.markdown,
                            &json!({"title":page.title,"pageId":page.page_id,"targetId":target.id,"sourceRefs":target.source_refs}),
                            &chrono::Utc::now().to_rfc3339(),
                        )?;
                        let capture = Capture {
                            raw_html: String::new(),
                            document,
                            collection: None,
                            gallery: None,
                            plates: Vec::new(),
                            episodes: Vec::new(),
                            jump_statistics: Vec::new(),
                            public_json: None,
                        };
                        write_private(
                            &directory.join(format!("{}.json", sha256(page.url.as_str()))),
                            &serde_json::to_vec(&capture).map_err(|error| error.to_string())?,
                        )?;
                    }
                },
                Err(error) => target_report.errors.push((target.id.clone(), error.to_string())),
            }
            target_report.attempts = budget.requests.get() - before;
            target_report.completed = target_report.completed && target_report.errors.is_empty();
            let captures = read_captures(&directory)?;
            target_report.documents = captures.len();
            let mut corpus = String::new();
            for entry in &captures {
                let document = &entry.document;
                corpus.push_str(&serde_json::to_string(&json!({"id":format!("{}-{}",target.id,&sha256(&document.canonical_url)[..16]),"name":document.payload.title_raw,"url":document.canonical_url,"markdown":document.payload.body_markdown,"lang":target.lang,"kind":target.kind,"provenance":document.provenance,"canonicalEligible":false})).map_err(|error|error.to_string())?);
                corpus.push('\n');
            }
            write_private(
                &options.output.join("corpus").join(format!("{}.jsonl", target.id)),
                corpus.as_bytes(),
            )?;
            report.errors.extend(target_report.errors.clone());
            report.targets.push(target_report);
            all_captures.extend(captures);
            continue;
        }
        let frontier_dir = options.output.join("frontier");
        std::fs::create_dir_all(&frontier_dir).map_err(|error| error.to_string())?;
        let mut frontier = Frontier::open(
            frontier_dir.join(format!("{}.sqlite", target.id)),
            FrontierOptions {
                per_host_delay_ms: i64::try_from(
                    target.per_host_delay_ms.unwrap_or(plan.defaults.per_host_delay_ms),
                )
                .unwrap_or(i64::MAX),
                max_in_flight_per_host: target
                    .max_in_flight_per_host
                    .unwrap_or(plan.defaults.max_in_flight_per_host),
                goal: target.goal.clone(),
                ..FrontierOptions::default()
            },
            chrono::Utc::now().timestamp_millis(),
        )
        .map_err(|error| error.to_string())?;
        if target.mode == "catalogue" {
            for edition in EDITIONS {
                enqueue(
                    &mut frontier,
                    &format!("https://comic.dragonballcn.com/{edition}.htm"),
                    options.force,
                )?;
            }
            enqueue(&mut frontier, "https://comic.dragonballcn.com/update.htm", options.force)?;
        }
        for seed in &target.seeds {
            let mut url = validate_source_url(seed)?;
            if target.mode == "shenron_api" {
                url.query_pairs_mut().append_pair("limit", "100").append_pair("offset", "0");
            }
            enqueue(&mut frontier, url.as_str(), options.force)?;
        }
        let capture =
            CaptureTransport { inner: &budget, target: &target, directory: directory.clone() };
        let before = budget.requests.get();
        let mut crawl = CrawlOptions {
            max_depth: if matches!(target.mode.as_str(), "catalogue" | "shenron_api" | "json") {
                0
            } else {
                options.max_depth.or(target.max_depth).unwrap_or(plan.defaults.max_depth)
            },
            max_requests: limit.saturating_sub(budget.requests.get()),
            max_concurrency: plan.defaults.max_concurrency.clamp(1, 8),
            allowed_domains: target.allowed_domains.clone(),
            include_url_regex: target.include_patterns.clone(),
            exclude_url_regex: target.exclude_patterns.clone(),
            obey_robots: plan.respect_robots,
            ingest_sitemaps: matches!(target.id.as_str(), "official" | "dragon-ball-official-en"),
            user_agent: plan.user_agent.clone(),
            ..CrawlOptions::default()
        };
        let step = crawl_bounded(&mut frontier, &capture, &crawl)
            .await
            .map_err(|error| error.to_string())?;
        target_report.errors.extend(step.errors);
        let initial = read_captures(&directory)?;
        if target.mode == "catalogue" && options.with_gallery {
            for entry in &initial {
                if let Some(collection) = &entry.collection {
                    for publication in &collection.publications {
                        enqueue(&mut frontier, &publication.url, options.force)?;
                    }
                }
            }
        }
        if target.id.starts_with("toei-") && crawl.max_depth > 0 {
            for entry in &initial {
                for episode in &entry.episodes {
                    if episode.source_url != entry.document.canonical_url {
                        enqueue(&mut frontier, &episode.source_url, options.force)?;
                    }
                }
            }
        }
        if target.mode == "shenron_api" {
            for entry in &initial {
                let Some(total) = entry
                    .public_json
                    .as_ref()
                    .and_then(|value| value.get("total"))
                    .and_then(Value::as_u64)
                else {
                    continue;
                };
                let mut page =
                    Url::parse(&entry.document.canonical_url).map_err(|error| error.to_string())?;
                if page.query_pairs().any(|(key, value)| key == "offset" && value != "0") {
                    continue;
                }
                // The page budget bounds even a corrupt remote total value.
                for offset in (100..total.min(5_000_000)).step_by(100).take(limit) {
                    page.set_query(None);
                    page.query_pairs_mut()
                        .append_pair("limit", "100")
                        .append_pair("offset", &offset.to_string());
                    enqueue(&mut frontier, page.as_str(), options.force)?;
                }
            }
        }
        if budget.requests.get() < limit
            && (options.with_gallery && target.mode == "catalogue"
                || target.mode == "shenron_api"
                || target.id.starts_with("toei-") && crawl.max_depth > 0)
        {
            crawl.max_requests = limit.saturating_sub(budget.requests.get());
            crawl.ingest_sitemaps = false;
            let step = crawl_bounded(&mut frontier, &capture, &crawl)
                .await
                .map_err(|error| error.to_string())?;
            target_report.errors.extend(step.errors);
        }
        let captures = read_captures(&directory)?;
        target_report.attempts = budget.requests.get() - before;
        target_report.documents = captures.len();
        let stats = frontier.stats().map_err(|error| error.to_string())?;
        target_report.pending = stats.pending;
        target_report.locked = stats.locked;
        target_report.failed = stats.failed;
        target_report.completed = stats.pending == 0
            && stats.locked == 0
            && stats.failed == 0
            && target_report.errors.is_empty();
        let corpus_path = options.output.join("corpus").join(format!("{}.jsonl", target.id));
        let mut corpus = String::new();
        for entry in &captures {
            let document = &entry.document;
            let value = json!({"id":format!("{}-{}",target.id,&sha256(&document.canonical_url)[..16]),"name":document.payload.title_raw,"url":document.canonical_url,"markdown":document.payload.body_markdown,"lang":target.lang,"kind":target.kind,"provenance":document.provenance,"canonicalEligible":false});
            corpus.push_str(&serde_json::to_string(&value).map_err(|error| error.to_string())?);
            corpus.push('\n');
            all_documents.insert(document.canonical_url.clone(), document.clone());
        }
        write_private(&corpus_path, corpus.as_bytes())?;
        report.errors.extend(target_report.errors.clone());
        report.targets.push(target_report);
        all_captures.extend(captures);
        report.network_requests = budget.requests.get();
        write_private(
            &options.output.join("report.json"),
            &serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
        )?;
    }
    // Include other already acquired targets; a selected-source run must never
    // erase another campaign's structured catalogue or projection.
    all_captures.clear();
    let captures_root = options.output.join("captures");
    if captures_root.is_dir() {
        for entry in std::fs::read_dir(&captures_root).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_dir() {
                all_captures.extend(read_captures(&path)?);
            }
        }
    }
    for capture in &all_captures {
        all_documents.insert(capture.document.canonical_url.clone(), capture.document.clone());
    }
    export_structured(&all_captures, &options.output, &mut report)?;
    let mut projection = String::new();
    for document in all_documents.into_values() {
        projection.push_str(&serde_json::to_string(&document).map_err(|error| error.to_string())?);
        projection.push('\n');
    }
    write_private(&report.projection, projection.as_bytes())?;
    report.documents = materialize_documents(&options.output)?;
    report.network_requests = budget.requests.get();
    report.completed =
        report.targets.iter().all(|target| target.completed) && report.errors.is_empty();
    write_private(
        &options.output.join("report.json"),
        &serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )?;
    Ok(report)
}

fn export_structured(
    captures: &[Capture],
    output: &Path,
    report: &mut DragonBallRunReport,
) -> Result<(), String> {
    let mut collections = Vec::new();
    let mut seen = HashSet::new();
    // Edition collections take precedence over miscellaneous indexes.
    for edition in EDITIONS {
        for capture in captures {
            if let Some(collection) = &capture.collection
                && collection.slug == *edition
            {
                let mut collection = collection.clone();
                collection.publications.retain(|book| seen.insert(book.did.clone()));
                collections.push(collection);
            }
        }
    }
    let mut miscellaneous = Vec::new();
    for capture in captures {
        if let Some(collection) = &capture.collection
            && !EDITIONS.contains(&collection.slug.as_str())
        {
            for book in &collection.publications {
                if seen.insert(book.did.clone()) {
                    miscellaneous.push(book.clone());
                }
            }
        }
    }
    if !miscellaneous.is_empty() {
        collections.push(Collection {
            slug: "divers".into(),
            title: "Databooks, artbooks and other publications".into(),
            source_title: None,
            url: "https://comic.dragonballcn.com/".into(),
            publications: miscellaneous,
        });
    }
    let mut inventory = BTreeMap::new();
    for collection in &mut collections {
        for publication in &mut collection.publications {
            if let Some(capture) = captures.iter().find(|capture| {
                capture.gallery.as_ref().is_some_and(|(did, _)| did == &publication.did)
            }) {
                if let Some((_, gallery)) = &capture.gallery {
                    publication.plates = (!gallery.pages.is_empty()).then_some(gallery.pages.len());
                    publication.gallery = Some(gallery.clone());
                }
                if !capture.plates.is_empty() {
                    publication.plates = Some(capture.plates.len());
                    inventory.insert(publication.did.clone(), capture.plates.clone());
                }
            }
        }
    }
    if !collections.is_empty() {
        let catalogue=Catalogue{source:"https://comic.dragonballcn.com".into(),fetched_at:chrono::Utc::now().to_rfc3339(),notice:"Bibliographic facts, publisher metadata and public image references. Source: 鳥山明漫画資料館. No implicit canon or rights determination; protected stores retain acquired material and provenance.".into(),collections};
        let path = output.join("dragonballcn.json");
        write_private(
            &path,
            &serde_json::to_vec_pretty(&catalogue).map_err(|error| error.to_string())?,
        )?;
        report.catalogue = Some(path);
        write_private(
            &output.join("dragonballcn-inventaire.json"),
            &serde_json::to_vec_pretty(&inventory).map_err(|error| error.to_string())?,
        )?;
        let mut snapshot_inventory = BTreeMap::new();
        let snapshot_collections:Vec<_>=catalogue.collections.iter().map(|collection|{
            let books:Vec<_>=collection.publications.iter().enumerate().map(|(index,book)|{
                if let Some(gallery)=&book.gallery {
                    let pages:Vec<_>=gallery.pages.iter().map(|page|{
                        let plate=inventory.get(&book.did).and_then(|plates|plates.iter().find(|plate|plate.file==page.name));
                        json!({"n":plate.map_or(u32::try_from(page.page_number).unwrap_or(u32::MAX),|plate|plate.n),"fichier":page.name,"poids":plate.and_then(|plate|plate.size.clone()),"ajoutee":plate.and_then(|plate|plate.added.clone()),"image_url":page.image_url,"thumb_url":page.thumb_url,"page_url":page.page_url})
                    }).collect();snapshot_inventory.insert(book.did.clone(),pages);
                } else if let Some(plates)=inventory.get(&book.did){snapshot_inventory.insert(book.did.clone(),plates.iter().map(|plate|json!(plate)).collect());}
                json!({"rang":index+1,"did":book.did,"titre":book.title.as_ref().unwrap_or(&book.label),"url_fiche":book.url,"premiere_edition":book.first_edition.as_ref().or(book.publication_date.as_ref()),"isbn":book.isbn,"magazine":book.magazine,"prix":book.price,"editeur":book.publisher,"rubrique":book.section,"rubrique_icone":book.section_icon,"date_affichee":book.display_date,"numerisation":book.scanned_date,"fil_forum":book.forum_thread,"planches":book.plates,"planches_recensees":book.plates,"dossier_distant":book.gallery.as_ref().and_then(|gallery|gallery.directory.as_deref()),"pagination":if book.plates.is_some(){"relevee"}else{"fiche muette"},"couverture":book.cover.as_ref().map(|url|json!({"source_url":url}))})
            }).collect();
            json!({"slug":collection.slug,"titre":collection.title,"titre_site":collection.source_title,"url":collection.url,"page_archivee":format!("./data/catalogues/pages/{}.html",collection.slug),"ouvrages":books})
        }).collect();
        let books: Vec<_> = catalogue
            .collections
            .iter()
            .flat_map(|collection| collection.publications.iter())
            .collect();
        let totals = json!({"collections":catalogue.collections.len(),"ouvrages":books.len(),"couvertures":0,"planches_recensees":books.iter().filter_map(|book|book.plates).sum::<usize>(),"avec_isbn":books.iter().filter(|book|book.isbn.is_some()).count(),"avec_date":books.iter().filter(|book|book.first_edition.is_some()||book.publication_date.is_some()).count(),"avec_pagination":books.iter().filter(|book|book.plates.is_some()).count()});
        let snapshot = json!({"schema":"aphrody-dragonballcn-snapshot/v1","source":catalogue.source,"titre_source":"鳥山明漫画資料館","releve_le":catalogue.fetched_at,"licence":"FAIR-USE-EDITORIAL","rights_status":"unreviewed-source-notice","perimetre":catalogue.notice,"collections":snapshot_collections,"totaux":totals});
        write_private(
            &output.join("assets/dragonballcn/index.json"),
            &serde_json::to_vec_pretty(&snapshot).map_err(|error| error.to_string())?,
        )?;
        write_private(
            &output.join("data/catalogues/dragonballcn.json"),
            &serde_json::to_vec_pretty(&catalogue).map_err(|error| error.to_string())?,
        )?;
        write_private(
            &output.join("data/catalogues/dragonballcn-inventaire.json"),
            &serde_json::to_vec_pretty(&snapshot_inventory).map_err(|error| error.to_string())?,
        )?;
    }
    let mut episodes = BTreeMap::new();
    let mut statistics = Vec::new();
    let mut assets = HashSet::new();
    let mut public_episodes = Vec::new();
    let mut public_movies = Vec::new();
    let mut links = Vec::new();
    for capture in captures {
        for episode in &capture.episodes {
            let key = format!("{}:{}", episode.series, episode.episode_number);
            if episodes.get(&key).is_none_or(|existing: &EpisodeSynopsis| {
                !episode.synopsis.is_empty() || existing.synopsis.is_empty()
            }) {
                episodes.insert(key, episode.clone());
            }
        }
        statistics.extend(capture.jump_statistics.clone());
        for media in &capture.document.payload.embedded_media {
            assets.insert(media.url.clone());
        }
        if let Some(value) = &capture.public_json {
            collect_public_assets(value, &mut assets);
            for (kind, items) in
                [("episode", value.get("episodes")), ("movie", value.get("movies"))]
            {
                if let Some(items) = items.and_then(Value::as_array) {
                    for item in items {
                        let id = item.get("id").and_then(Value::as_u64);
                        let slug = item.get("slug").and_then(Value::as_str);
                        if let Some(segment) = if kind == "episode" {
                            id.map(|id| id.to_string())
                        } else {
                            slug.map(str::to_owned)
                        } {
                            links.push(json!({"kind":kind,"id":id,"slug":slug,"title":item.get("title"),"series":item.get("series"),"pageUrl":format!("https://dragonballfr.com/wiki/{}/{segment}",if kind=="episode"{"episodes"}else{"movies"}),"apiUrl":format!("https://bot.dragonballfr.com/api/public/wiki/{}/{segment}",if kind=="episode"{"episodes"}else{"movies"})}));
                        }
                        if kind == "episode" {
                            public_episodes.push(item.clone());
                        } else {
                            public_movies.push(item.clone());
                        }
                    }
                }
            }
        }
    }
    let mut assets: Vec<_> = assets.into_iter().collect();
    assets.sort();
    for (name, value) in [
        (
            "toei-episodes.json",
            serde_json::to_value(episodes.into_values().collect::<Vec<_>>())
                .map_err(|error| error.to_string())?,
        ),
        ("jump-stats.json", serde_json::to_value(statistics).map_err(|error| error.to_string())?),
        (
            "shenron-catalogue.json",
            json!({"episodes":public_episodes,"movies":public_movies,"assets":assets}),
        ),
        ("shenron-assets.json", json!(assets)),
        ("dragonballfr-training-links.json", json!(links)),
    ] {
        write_private(
            &output.join(name),
            &serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
        )?;
    }
    export_bxc_artifacts(captures, output, report)?;
    Ok(())
}

fn export_bxc_artifacts(
    captures: &[Capture],
    output: &Path,
    report: &DragonBallRunReport,
) -> Result<(), String> {
    let mut articles = BTreeMap::new();
    let mut episodes = BTreeMap::new();
    let mut biographies = json!({"inlifeBio":"","caramelData":"","wikiJaSummary":""});
    let mut archive = None;
    let mut wiki = None;
    let mut timeline = None;
    let mut chronology = None;
    for capture in captures {
        let url = validate_source_url(&capture.document.canonical_url)?;
        let host = url.host_str().unwrap_or_default();
        if host == "dragonballfr.com" && url.path() == "/api/v1/wiki/timeline" {
            timeline = capture.public_json.clone();
        }
        if host == "dragonballfr.com" && url.path() == "/api/v1/site/chronology" {
            chronology = capture.public_json.clone();
        }
        if host == "dragon-ball-official.com" || host.ends_with(".dragon-ball-official.com") {
            for article in parse_official_articles(&capture.raw_html, &url) {
                let detail = article.content_markdown.is_some();
                if articles.get(&article.url).is_none_or(|old: &super::OfficialArticle| {
                    detail || old.content_markdown.is_none()
                }) {
                    articles.insert(article.url.clone(), article);
                }
            }
        }
        for episode in &capture.episodes {
            let key = (episode.series.clone(), episode.episode_number);
            if episodes.get(&key).is_none_or(|old: &EpisodeSynopsis| {
                !episode.synopsis.is_empty() || old.synopsis.is_empty()
            }) {
                episodes.insert(key, episode.clone());
            }
        }
        let bio_key = if host == "www.caramel.co.jp" {
            Some("caramelData")
        } else if host == "web.archive.org" && url.path().contains("inlifeweb.com") {
            Some("inlifeBio")
        } else if host == "ja.wikipedia.org"
            && capture.document.provenance.get("targetId").and_then(Value::as_str)
                == Some("toriyama-biography")
        {
            Some("wikiJaSummary")
        } else {
            None
        };
        if let Some(key) = bio_key {
            biographies[key] = json!(capture.document.payload.body_markdown);
        }
        if host == "archive.org"
            && url.path() == "/metadata/drslump"
            && let Some(item) = &capture.public_json
        {
            archive =
                Some(aphrody_web_extract::dragon_ball::archive_manifest(item, Some("dr_slump"))?);
        }
        if host == "ja.wikipedia.org" && bio_key == Some("wikiJaSummary") {
            wiki = Some(
                json!({"url":url,"title":capture.document.payload.title_raw,"content":capture.document.payload.body_markdown,"images":capture.document.payload.embedded_media.iter().filter(|media|media.kind=="image").collect::<Vec<_>>(),"provenance":capture.document.provenance}),
            );
        }
        if let Some(collection) = &capture.collection
            && !capture.raw_html.is_empty()
        {
            let safe_slug = &collection.slug;
            if !safe_slug.is_empty()
                && safe_slug
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            {
                write_private(
                    &output.join("data/catalogues/pages").join(format!("{safe_slug}.html")),
                    capture.raw_html.as_bytes(),
                )?;
            }
        }
    }
    let mut datasets = BTreeMap::from([
        ("news", "db_official_news.json"),
        ("jumpStats", "jajanken_jump_stats.json"),
        ("toriyamaArchives", "toriyama_archives.json"),
        ("shenronCatalogue", "shenron_catalogue.json"),
        ("shenronAssets", "shenron_assets.json"),
    ]);
    for (series, name, key) in [
        ("dragon_ball_z", "toei_episodes_dbz.json", "episodesDbz"),
        ("dragon_ball_super", "toei_episodes_dbs.json", "episodesDbs"),
        ("dragon_ball_kai", "toei_episodes_kai.json", "episodesKai"),
        ("dragon_ball", "toei_episodes_classic.json", "episodesClassic"),
        ("dragon_gt", "toei_episodes_gt.json", "episodesGt"),
        ("dragonball_daima", "toei_episodes_daima.json", "episodesDaima"),
    ] {
        let rows: Vec<_> = episodes.values().filter(|episode| episode.series == series).collect();
        write_private(
            &output.join(name),
            &serde_json::to_vec_pretty(&rows).map_err(|error| error.to_string())?,
        )?;
        datasets.insert(key, name);
    }
    let news: Vec<_> = articles.into_values().collect();
    write_private(
        &output.join("db_official_news.json"),
        &serde_json::to_vec_pretty(&news).map_err(|error| error.to_string())?,
    )?;
    write_private(
        &output.join("toriyama_archives.json"),
        &serde_json::to_vec_pretty(&biographies).map_err(|error| error.to_string())?,
    )?;
    for (source, destination) in [
        ("jump-stats.json", "jajanken_jump_stats.json"),
        ("shenron-catalogue.json", "shenron_catalogue.json"),
        ("shenron-assets.json", "shenron_assets.json"),
    ] {
        write_private(
            &output.join(destination),
            &std::fs::read(output.join(source)).map_err(|error| error.to_string())?,
        )?;
    }
    let mut modules = vec!["shenron-documents.jsonl"];
    if timeline.is_some() || chronology.is_some() {
        let value = json!({"schema":"aphrody-shenron-timeline/v1","items":timeline.as_ref().and_then(|value|value.get("items")),"chronology":chronology.as_ref().and_then(|value|value.get("config")),"sources":["https://dragonballfr.com/api/v1/wiki/timeline","https://dragonballfr.com/api/v1/site/chronology"],"publicPage":"https://dragonballfr.com/wiki/timeline","provenance":{"owner":"shenron","orderingMeaning":"source-product-preserved","canonicalApproval":false},"completed":timeline.is_some()&&chronology.is_some()});
        write_private(
            &output.join("shenron-timeline.json"),
            &serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
        )?;
        modules.push("shenron-timeline.json");
    }
    for (name, value) in [("archive-drslump.json", archive), ("wiki-toriyama.json", wiki)] {
        if let Some(value) = value {
            write_private(
                &output.join(name),
                &serde_json::to_vec_pretty(&json!({"status":"ok","data":value}))
                    .map_err(|error| error.to_string())?,
            )?;
            modules.push(name);
        }
    }
    let manifest = json!({"schema":"bxc-dragonball-crawl/v1","generatedAt":chrono::Utc::now().to_rfc3339(),"source":"aphrody-web-crawl","datasets":datasets,"modules":modules,"completed":report.targets.iter().all(|target|target.completed)&&report.errors.is_empty(),"editorialOwner":"shenron","canonicalApproval":false});
    write_private(
        &output.join("shenron-ingest-manifest.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )?;
    Ok(())
}

fn collect_public_assets(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_public_assets(value, output);
            }
        },
        Value::Object(fields) => {
            for (key, value) in fields {
                if key == "frames"
                    && let Some(raw) = value.as_str()
                    && let Ok(parsed) = serde_json::from_str::<Value>(raw)
                {
                    collect_public_assets(&parsed, output);
                } else if ["image", "imagePath", "scene_preview", "thumbnail", "poster"]
                    .iter()
                    .any(|name| key.contains(name))
                    && let Some(raw) = value.as_str()
                {
                    if let Ok(url) = Url::parse("https://cdn.dragonballfr.com/")
                        .expect("static CDN origin")
                        .join(raw)
                        && validate_source_url(url.as_str()).is_ok()
                    {
                        output.insert(url.to_string());
                    }
                } else {
                    collect_public_assets(value, output);
                }
            }
        },
        _ => {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    struct Fixture(HashMap<String, String>);
    impl CrawlTransport for Fixture {
        async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
            Ok(FetchResult {
                url: url.clone(),
                status: 200,
                content_type: Some("text/html".into()),
                body: self
                    .0
                    .get(url.as_str())
                    .ok_or_else(|| format!("missing fixture {url}"))?
                    .clone(),
            })
        }
    }
    #[tokio::test]
    async fn campaigns_resume_and_export_native_markdown_without_network_replay() {
        let output = std::env::temp_dir()
            .join(format!("aphrody-dragon-ball-campaign-{}", std::process::id()));
        let mut plan = DragonBallPlan::default();
        plan.targets.retain(|target| target.id == "guides");
        plan.targets[0].seeds = vec!["https://www.kanzenshuu.com/translations/one/".into()];
        plan.defaults.per_host_delay_ms = 0;
        plan.respect_robots = false;
        let raw = "<title>Interview</title><nav><img src='https://cdn.example.org/reference.jpg'></nav><script>const video = 'https://cdn.example.org/interview.mp4';</script><main id='content'><h1>Akira Toriyama</h1><p>Source evidence is kept separately from the approved editorial canon.</p></main>";
        let fixture = Fixture(HashMap::from([(
            "https://www.kanzenshuu.com/translations/one/".into(),
            raw.into(),
        )]));
        let options = DragonBallRunOptions {
            output: output.clone(),
            sources: Vec::new(),
            max_requests: Some(5),
            max_depth: Some(0),
            with_gallery: false,
            force: false,
        };
        let report = run_dragon_ball(&plan, &options, &fixture).await.unwrap();
        assert_eq!(report.documents, 1);
        assert_eq!(report.network_requests, 1);
        let document: DragonBallDocument = serde_json::from_str(
            std::fs::read_to_string(output.join("shenron-documents.jsonl"))
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        // BXC's historical projection hashes body_markdown; the acquisition
        // capture separately retains the complete source HTML for media parity.
        assert_eq!(document.raw_checksum, sha256(&document.payload.body_markdown));
        let captures = read_captures(&output.join("captures/guides")).unwrap();
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].raw_html, raw);
        assert!(document.payload.embedded_media.iter().any(|media| {
            media.url == "https://cdn.example.org/reference.jpg" && media.kind == "image"
        }));
        assert!(document.payload.embedded_media.iter().any(|media| {
            media.url == "https://cdn.example.org/interview.mp4" && media.kind == "video"
        }));
        assert!(!document.payload.body_markdown.contains("cdn.example.org"));
        let report = run_dragon_ball(&plan, &options, &Fixture(HashMap::new())).await.unwrap();
        assert_eq!(report.documents, 1);
        assert_eq!(report.network_requests, 0);
        assert_eq!(materialize_documents(&output).unwrap(), 1);
        std::fs::remove_dir_all(output).unwrap();
    }
    #[tokio::test]
    async fn all_targets_share_one_network_budget() {
        let output =
            std::env::temp_dir().join(format!("aphrody-dragon-ball-budget-{}", std::process::id()));
        let mut plan = DragonBallPlan::default();
        plan.targets.retain(|target| matches!(target.id.as_str(), "dbm-fr" | "dbm-en"));
        plan.respect_robots = false;
        plan.defaults.per_host_delay_ms = 0;
        let fixture=Fixture(plan.targets.iter().map(|target|(target.seeds[0].clone(),"<main><p>Dragon Ball Multiverse community production with its own provenance.</p></main>".into())).collect());
        let report = run_dragon_ball(
            &plan,
            &DragonBallRunOptions {
                output: output.clone(),
                sources: Vec::new(),
                max_requests: Some(1),
                max_depth: Some(0),
                with_gallery: false,
                force: false,
            },
            &fixture,
        )
        .await
        .unwrap();
        assert_eq!(report.network_requests, 1);
        assert_eq!(report.targets.len(), 2);
        assert_eq!(report.targets[1].pending, 1);
        std::fs::remove_dir_all(output).unwrap();
    }

    #[tokio::test]
    async fn bxc_dataset_filenames_and_manifest_keep_structured_fields() {
        let output = std::env::temp_dir()
            .join(format!("aphrody-dragon-ball-bxc-contract-{}", std::process::id()));
        let mut plan = DragonBallPlan::default();
        plan.targets.retain(|target| {
            matches!(
                target.id.as_str(),
                "official" | "toei-dragon" | "archive-drslump" | "shenron-timeline"
            )
        });
        plan.respect_robots = false;
        plan.defaults.per_host_delay_ms = 0;
        for target in &mut plan.targets {
            if target.id == "official" {
                target.seeds = vec!["https://dragon-ball-official.com/news/01_42.html".into()];
            }
            if target.id == "toei-dragon" {
                target.seeds =
                    vec!["https://lineup.toei-anim.co.jp/ja/tv/dragon/episode/1/".into()];
            }
        }
        let fixture=Fixture(HashMap::from([
            ("https://dragon-ball-official.com/news/01_42.html".into(),"<h3 class='news-post__title'>Source interview</h3><time datetime='2026-10-07'></time><div class='entry-article'><p>Evidence with its provenance.</p></div>".into()),
            ("https://lineup.toei-anim.co.jp/ja/tv/dragon/episode/1/".into(),"<h1 class='story_caption_title'>Episode one</h1><div class='text_details_inner'>The publisher synopsis.</div>".into()),
            ("https://archive.org/metadata/drslump".into(),r#"{"metadata":{"identifier":"drslump"},"files":[{"name":"001 - Episode.mp4","sha1":"abc"}]}"#.into()),
            ("https://dragon-ball-official.com/robots.txt".into(),"User-agent: *\nAllow: /".into()),
            ("https://dragon-ball-official.com/sitemap.xml".into(),"<urlset></urlset>".into()),
            ("https://dragonballfr.com/api/v1/wiki/timeline".into(),r#"{"items":[{"kind":"episode","id":1,"date":null,"era":"unknown","number":1}]}"#.into()),
            ("https://dragonballfr.com/api/v1/site/chronology".into(),r#"{"config":{"version":1,"eraOrder":["unknown"],"overrides":{}}}"#.into()),
        ]));
        let report = run_dragon_ball(
            &plan,
            &DragonBallRunOptions {
                output: output.clone(),
                sources: Vec::new(),
                max_requests: Some(7),
                max_depth: Some(0),
                with_gallery: false,
                force: false,
            },
            &fixture,
        )
        .await
        .unwrap();
        assert!(report.completed);
        let read = |name: &str| {
            serde_json::from_slice::<Value>(&std::fs::read(output.join(name)).unwrap()).unwrap()
        };
        assert_eq!(read("db_official_news.json")[0]["date"], "2026-10-07");
        assert_eq!(read("toei_episodes_classic.json")[0]["episodeNumber"], 1);
        assert_eq!(read("toei_episodes_classic.json")[0]["broadcastDate"], Value::Null);
        assert_eq!(read("archive-drslump.json")["data"]["files"][0]["sha1"], "abc");
        assert_eq!(read("shenron-timeline.json")["items"][0]["date"], Value::Null);
        assert_eq!(
            read("shenron-timeline.json")["provenance"]["orderingMeaning"],
            "source-product-preserved"
        );
        assert_eq!(
            read("shenron-ingest-manifest.json")["datasets"]["episodesClassic"],
            "toei_episodes_classic.json"
        );
        assert!(read("shenron-ingest-manifest.json").get("shenronCanon").is_none());
        std::fs::remove_dir_all(output).unwrap();
    }
}
