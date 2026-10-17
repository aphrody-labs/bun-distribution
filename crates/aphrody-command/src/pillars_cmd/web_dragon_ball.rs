// SPDX-License-Identifier: Apache-2.0
//! Product CLI for the native Dragon Ball owner and the existing home pipeline.

use std::path::PathBuf;

#[path = "web_dragon_ball_discovery.rs"]
mod discovery;
use std::{sync::Arc, time::Duration};

use aphrody_rag::home::{HomeLayout, HomeScope};
use aphrody_web_crawl::dragon_ball::{
    DragonBallPlan, DragonBallRunOptions, export_bxc, run_dragon_ball, source_registry,
};
use clap::{Args, Subcommand};
use miette::{IntoDiagnostic, miette};
use serde_json::{Value, json};

struct RenderedTransport {
    context: Arc<obscura_browser::BrowserContext>,
    http: aphrody_web_crawl::BunBrowserTransport,
}

fn requires_http_body(url: &reqwest::Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    path.ends_with("/robots.txt")
        || path.ends_with(".xml")
        || path.ends_with(".json")
        || path.ends_with("/api.php")
        || path.ends_with("/advancedsearch.php")
        || path
            .split('/')
            .any(|segment| matches!(segment, "api" | "metadata"))
}

impl aphrody_web_crawl::CrawlTransport for RenderedTransport {
    async fn fetch(&self, url: &reqwest::Url) -> Result<aphrody_web_crawl::FetchResult, String> {
        if requires_http_body(url) {
            return self.http.fetch(url).await;
        }
        aphrody_web_service::validate_page_url(url.as_str())?;
        let mut page =
            obscura_browser::Page::new("dragon-ball-campaign".into(), Arc::clone(&self.context));
        tokio::time::timeout(
            Duration::from_secs(45),
            page.navigate_with_wait(url.as_str(), obscura_browser::lifecycle::WaitUntil::Load),
        )
        .await
        .map_err(|_| "rendered source navigation exceeded its deadline".to_owned())?
        .map_err(|error| error.to_string())?;
        let event = page
            .network_events
            .iter()
            .rev()
            .find(|event| event.resource_type == "Document")
            .ok_or_else(|| "rendered source reported no document response".to_owned())?;
        let status = event.status;
        let content_type = event
            .response_headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
            .map(|(_, value)| value.clone());
        let url = page
            .url
            .clone()
            .ok_or_else(|| "rendered source has no final URL".to_owned())?;
        let body = page
            .evaluate("document.documentElement.outerHTML")
            .as_str()
            .ok_or_else(|| "rendered source returned no HTML".to_owned())?
            .to_owned();
        if body.len() > 8 * 1024 * 1024 {
            return Err("rendered source exceeded 8 MiB".into());
        }
        Ok(aphrody_web_crawl::FetchResult {
            url,
            status,
            content_type,
            body,
        })
    }
}

#[derive(Debug, Args)]
pub(crate) struct CorpusArgs {
    /// Private campaign output directory
    #[arg(long)]
    output: Option<PathBuf>,
    /// Isolated home profile (Shenron by default)
    #[arg(long, default_value = "shenron")]
    profile: String,
    /// State root (default: APHRODY_HOME or ~/.aphrody)
    #[arg(long)]
    state: Option<PathBuf>,
    /// Emit the structured report (also the default)
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Args)]
pub(crate) struct IndexArgs {
    #[command(flatten)]
    corpus: CorpusArgs,
    /// Local public Shenron/CDN or bibliographic catalogue JSON (repeatable; no network)
    #[arg(long = "catalogue", alias = "catalog")]
    catalogues: Vec<PathBuf>,
}

#[derive(Debug, Args)]
pub(crate) struct CampaignArgs {
    #[command(flatten)]
    corpus: CorpusArgs,
    /// Native campaign configuration (otherwise the embedded plan)
    #[arg(long)]
    config: Option<PathBuf>,
    /// Source identifiers (repeatable or comma-separated); omitted selects enabled sources
    #[arg(long = "source", value_delimiter = ',')]
    sources: Vec<String>,
    /// Request budget for this campaign
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=5000))]
    max_requests: Option<u32>,
    /// Override the maximum link depth
    #[arg(long, value_parser = clap::value_parser!(u32).range(0..=10))]
    max_depth: Option<u32>,
    /// Collect the bounded gallery declared by the source
    #[arg(long)]
    with_gallery: bool,
    /// Refresh completed source artifacts
    #[arg(long)]
    force: bool,
    /// Import exact registry-owned seeds from a previous native discovery plan
    #[arg(long)]
    discovery_plan: Option<PathBuf>,
    /// Render JavaScript with the native Obscura browser (robots remain plain HTTP)
    #[arg(long)]
    render: bool,
}

#[derive(Debug, Args)]
pub(crate) struct AssetArgs {
    #[command(flatten)]
    corpus: CorpusArgs,
    #[arg(long, default_value_t = 300, value_parser = clap::value_parser!(u32).range(1..=5000))]
    max_files: u32,
    #[arg(long)]
    plates: bool,
    #[arg(long, default_value_t = 82, value_parser = clap::value_parser!(u32).range(0..=100))]
    quality: u32,
    #[arg(long)]
    lossless: bool,
    #[arg(long)]
    force: bool,
    #[arg(long)]
    collection: Option<String>,
    #[arg(long)]
    did: Option<String>,
    #[arg(long)]
    local_reserve: Option<PathBuf>,
    /// Source reference retained in each acquired volume's receipt
    #[arg(long)]
    reference: Option<String>,
    #[arg(long)]
    grayscale: bool,
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=20000))]
    max_width: Option<u32>,
    /// Existing JSON array of declared public image requests and relative output paths
    #[arg(long)]
    requests: Option<PathBuf>,
    #[arg(long, default_value_t = 1200, value_parser = clap::value_parser!(u64).range(0..=60000))]
    delay_ms: u64,
    /// Render the manga source page with the native browser
    #[arg(long)]
    render: bool,
}

#[derive(Debug, Subcommand)]
pub(crate) enum DragonBallAction {
    /// Discover Google sources, media references and root technology evidence
    Discover(discovery::DiscoveryArgs),
    /// Inspect the embedded campaign and source registry
    Sources {
        #[arg(long)]
        json: bool,
    },
    /// Resolve a campaign without fetching or writing
    Plan(CampaignArgs),
    /// Inspect existing campaign evidence without fetching or writing
    Status(CorpusArgs),
    /// Crawl and extract a native campaign into its protected corpus
    Crawl {
        #[command(flatten)]
        campaign: CampaignArgs,
        /// Index campaign documents in the selected home after collection
        #[arg(long)]
        index: bool,
    },
    /// Index existing campaign exports without any network collection
    Index(IndexArgs),
    /// Download campaign covers (and optional plates) into the protected asset store
    Assets(AssetArgs),
    /// Resolve asset requests without collection or writes
    AssetPlan(AssetArgs),
    /// Probe at most three images; retain quota evidence but no media
    AssetProbe(AssetArgs),
    /// Acquire original manga reader images through the native Web owners
    MangaVolume {
        #[arg(long, value_parser = clap::value_parser!(u32).range(1..=42))]
        volume: u32,
        #[command(flatten)]
        acquisition: AssetArgs,
    },
    /// Consolidate legacy BXC stores into a new protected native store (sources remain read-only)
    ConsolidateBxc {
        #[arg(required = true, num_args = 1..)]
        databases: Vec<PathBuf>,
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Read legacy BXC databases and export their native Shenron projection
    ExportBxc {
        #[arg(required = true, num_args = 1..)]
        databases: Vec<PathBuf>,
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        json: bool,
    },
}

fn layout(args: &CorpusArgs) -> miette::Result<HomeLayout> {
    let scope = HomeScope::from_profile(Some(&args.profile));
    match &args.state {
        Some(state) => HomeLayout::in_state(state, &scope),
        None => HomeLayout::resolve(&scope),
    }
    .into_diagnostic()
}

fn output(args: &CorpusArgs, layout: &HomeLayout) -> PathBuf {
    args.output
        .clone()
        .unwrap_or_else(|| layout.home.join("private/web/dragon-ball"))
}

fn campaign(
    args: &CampaignArgs,
    output: PathBuf,
) -> miette::Result<(DragonBallPlan, DragonBallRunOptions)> {
    let mut plan = match &args.config {
        Some(path) => {
            serde_json::from_slice(&std::fs::read(path).into_diagnostic()?).into_diagnostic()?
        }
        None => DragonBallPlan::default(),
    };
    if let Some(path) = &args.discovery_plan {
        discovery::extend_plan(&mut plan, path)?;
    }
    plan.selected_targets(&args.sources)
        .map_err(|error| miette!("invalid Dragon Ball selection: {error}"))?;
    let options = DragonBallRunOptions {
        output,
        sources: args.sources.clone(),
        max_requests: args
            .max_requests
            .map(usize::try_from)
            .transpose()
            .into_diagnostic()?,
        max_depth: args.max_depth,
        with_gallery: args.with_gallery,
        force: args.force,
    };
    Ok((plan, options))
}

async fn index_existing(args: &CorpusArgs, catalogues: &[PathBuf]) -> miette::Result<Value> {
    let layout = layout(args)?;
    let output = output(args, &layout);
    if !output.is_dir() && !catalogues.is_empty() {
        super::crawl_index::private_directory(&output)?;
    }
    if !output.is_dir() {
        return Err(miette!("campaign output directory does not exist"));
    }
    let _lock = super::crawl_index::job_lock(&output)?;
    let written =
        aphrody_web_crawl::dragon_ball::materialize_documents_with_catalogues(&output, catalogues)
            .map_err(|error| miette!("Dragon Ball export materialization failed: {error}"))?;
    let documents = output.join("documents");
    if !documents.is_dir() {
        return Err(miette!("campaign has no indexable documents"));
    }
    // Distinct campaign roots must not replace each other in the same profile store.
    use sha2::{Digest, Sha256};
    use std::fmt::Write;
    let canonical = output.canonicalize().into_diagnostic()?;
    let mut source = String::from("web:dragon-ball:");
    for byte in Sha256::digest(canonical.as_os_str().as_encoded_bytes()) {
        write!(&mut source, "{byte:02x}").expect("writing into String");
    }
    let report = aphrody_rag::pipeline::run_pipeline(&layout, &source, &documents)
        .await
        .into_diagnostic()?;
    if !report.errors.is_empty() {
        return Err(miette!("Dragon Ball indexing reported errors"));
    }
    Ok(
        json!({"profile": args.profile, "output": output, "materialized": written, "catalogues": catalogues, "index": report}),
    )
}

enum AssetMode {
    Acquire,
    Plan,
    Probe,
    Manga(u32),
}

async fn run_assets(args: AssetArgs, mode: AssetMode) -> miette::Result<Value> {
    use aphrody_web_crawl::dragon_ball::{
        DragonBallAssetOptions, acquire_manga_volume, plan_asset_requests, probe_assets,
        sync_assets,
    };
    let layout = layout(&args.corpus)?;
    let output = output(&args.corpus, &layout);
    let mut options = DragonBallAssetOptions::new(output.clone());
    options.max_files = usize::try_from(args.max_files).into_diagnostic()?;
    options.plates = args.plates;
    options.quality = args.quality as f32;
    options.lossless = args.lossless;
    options.force = args.force;
    options.collection = args.collection;
    options.did = args.did;
    options.local_reserve = args.local_reserve;
    options.reference = args.reference;
    options.grayscale = args.grayscale;
    options.max_width = args.max_width;
    options.delay_ms = args.delay_ms;
    if let Some(path) = args.requests {
        options.requests =
            serde_json::from_slice(&std::fs::read(path).into_diagnostic()?).into_diagnostic()?;
    }
    if matches!(mode, AssetMode::Plan) {
        let requests =
            plan_asset_requests(&options).map_err(|error| miette!("asset plan failed: {error}"))?;
        return Ok(
            json!({"mode":"asset-plan", "profile":args.corpus.profile,"output":output,"requests":requests}),
        );
    }
    super::crawl_index::private_directory(&output)?;
    let _lock = super::crawl_index::job_lock(&output)?;
    obscura_net::ensure_rustls_crypto_provider();
    let client = obscura_net::BunBrowserHttpClient::new();
    if matches!(mode, AssetMode::Probe) {
        let probes = probe_assets(&client, &options)
            .await
            .map_err(|error| miette!("asset probe failed: {error}"))?;
        let completed = probes
            .iter()
            .all(|probe| probe.valid_image && probe.error.is_none());
        return Ok(
            json!({"mode":"asset-probe","profile":args.corpus.profile,"completed":completed,"probes":probes}),
        );
    }
    let report = match mode {
        AssetMode::Manga(volume) if args.render => {
            let pages = RenderedTransport {
                context: Arc::new(obscura_browser::BrowserContext::with_options(
                    "dragon-ball-manga".into(),
                    None,
                    false,
                )),
                http: aphrody_web_crawl::BunBrowserTransport::default(),
            };
            acquire_manga_volume(&pages, &client, volume, &options).await
        }
        AssetMode::Manga(volume) => {
            acquire_manga_volume(
                &aphrody_web_crawl::BunBrowserTransport::default(),
                &client,
                volume,
                &options,
            )
            .await
        }
        _ => sync_assets(&client, &options).await,
    }
    .map_err(|error| miette!("Dragon Ball acquisition failed: {error}"))?;
    Ok(json!({"profile":args.corpus.profile,"assets":report}))
}

pub(super) async fn run(action: DragonBallAction) -> miette::Result<Value> {
    match action {
        DragonBallAction::Discover(args) => discovery::run(args).await,
        DragonBallAction::Sources { json: _ } => Ok(json!({
            "plan": DragonBallPlan::default(), "registry": source_registry(),
        })),
        DragonBallAction::Plan(args) => {
            let layout = layout(&args.corpus)?;
            let (plan, options) = campaign(&args, output(&args.corpus, &layout))?;
            let targets = plan
                .selected_targets(&options.sources)
                .map_err(|error| miette!("invalid Dragon Ball selection: {error}"))?;
            Ok(
                json!({"mode": "plan", "profile": args.corpus.profile, "targets": targets, "plan": plan,
                "selection": {"output": options.output, "sources": options.sources,
                "maxRequests": options.max_requests, "maxDepth": options.max_depth,
                "withGallery": options.with_gallery, "force": options.force, "render": args.render}}),
            )
        }
        DragonBallAction::Status(args) => {
            let layout = layout(&args)?;
            let output = output(&args, &layout);
            let mut reports = serde_json::Map::new();
            for name in ["report.json", "summary.json", "manifest.json"] {
                let path = output.join(name);
                if path.is_file() {
                    let report: Value =
                        serde_json::from_slice(&std::fs::read(path).into_diagnostic()?)
                            .into_diagnostic()?;
                    reports.insert(name.to_owned(), report);
                }
            }
            Ok(
                json!({"mode": "status", "profile": args.profile, "output": output,
                "exists": output.is_dir(), "documentsExist": output.join("documents").is_dir(),
                "reports": reports}),
            )
        }
        DragonBallAction::Index(args) => index_existing(&args.corpus, &args.catalogues).await,
        DragonBallAction::Crawl {
            campaign: args,
            index,
        } => {
            let layout = layout(&args.corpus)?;
            let output = output(&args.corpus, &layout);
            let (plan, options) = campaign(&args, output.clone())?;
            super::crawl_index::private_directory(&output)?;
            let report = {
                let _lock = super::crawl_index::job_lock(&output)?;
                obscura_net::ensure_rustls_crypto_provider();
                if args.render {
                    let transport = RenderedTransport {
                        context: Arc::new(obscura_browser::BrowserContext::with_options(
                            "dragon-ball".into(),
                            None,
                            false,
                        )),
                        http: aphrody_web_crawl::BunBrowserTransport::default(),
                    };
                    run_dragon_ball(&plan, &options, &transport).await
                } else {
                    run_dragon_ball(
                        &plan,
                        &options,
                        &aphrody_web_crawl::BunBrowserTransport::default(),
                    )
                    .await
                }
                .map_err(|error| miette!("Dragon Ball campaign failed: {error}"))?
            };
            let mut value = json!({"profile": args.corpus.profile, "campaign": report});
            if index {
                value["index"] = index_existing(&args.corpus, &[]).await?;
            }
            Ok(value)
        }
        DragonBallAction::Assets(args) => run_assets(args, AssetMode::Acquire).await,
        DragonBallAction::AssetPlan(args) => run_assets(args, AssetMode::Plan).await,
        DragonBallAction::AssetProbe(args) => run_assets(args, AssetMode::Probe).await,
        DragonBallAction::MangaVolume {
            volume,
            acquisition,
        } => run_assets(acquisition, AssetMode::Manga(volume)).await,
        DragonBallAction::ConsolidateBxc {
            databases,
            output,
            json: _,
        } => {
            let report = aphrody_web_crawl::dragon_ball::consolidate_bxc(&databases, &output)
                .map_err(|error| miette!("BXC consolidation failed: {error}"))?;
            serde_json::to_value(report).into_diagnostic()
        }
        DragonBallAction::ExportBxc {
            databases,
            output,
            json: _,
        } => {
            let documents = export_bxc(&databases, &output)
                .map_err(|error| miette!("BXC projection failed: {error}"))?;
            Ok(json!({"output": output, "documents": documents}))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_rendered_campaigns_preserve_structured_source_responses() {
        for source in [
            "https://dragonballfr.com/api/v1/wiki/timeline",
            "https://archive.org/metadata/akira-toriyama",
            "https://kanzenshuu.com/wiki/api.php?action=query&format=json",
            "https://example.org/catalogue.json",
        ] {
            assert!(
                requires_http_body(&reqwest::Url::parse(source).unwrap()),
                "{source}"
            );
        }
        assert!(!requires_http_body(
            &reqwest::Url::parse("https://dragon-ball-official.com/news/01_1.html").unwrap()
        ));
    }

    #[tokio::test]
    async fn existing_exports_index_without_collection_and_keep_campaigns_separate() {
        let state = tempfile::tempdir().unwrap();
        for (name, term) in [("first", "Kanzentaifixture"), ("second", "ToeiFixture")] {
            let output = state.path().join(name);
            super::super::crawl_index::private_directory(&output).unwrap();
            let record = json!({"url": format!("https://dragonballfr.com/{name}"),
                "name": name, "markdown": format!("{term} existing campaign export.")});
            std::fs::write(output.join("export.jsonl"), format!("{record}\n")).unwrap();
            let args = CorpusArgs {
                output: Some(output),
                profile: "shenron".into(),
                state: Some(state.path().to_path_buf()),
                json: true,
            };
            let report = index_existing(&args, &[]).await.unwrap();
            assert_eq!(report["materialized"], 1);
            assert_eq!(report["index"]["indexed"], 1);
        }
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("shenron".into())).unwrap();
        let db = aphrody_rag::home::HomeDb::open_read_only(&layout.db_path).unwrap();
        for term in ["Kanzentaifixture", "ToeiFixture"] {
            let hits = aphrody_rag::home::unified_search(&db, term, &Default::default()).unwrap();
            assert!(!hits.is_empty(), "campaign document lost: {term}");
        }
        let aphrody =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("aphrody".into())).unwrap();
        assert!(!aphrody.db_path.exists());
    }
    #[tokio::test]
    async fn explicit_catalogue_can_seed_an_empty_campaign_in_its_isolated_profile() {
        let state = tempfile::tempdir().unwrap();
        let catalogue = state.path().join("manga.json");
        std::fs::write(&catalogue, json!({"schema":"shenron-manga-cdn/v1","volumes":[{"id":1,"title":"CatalogueFixtureGohan","isbn":"fixture-isbn"}],"chapters":[]}).to_string()).unwrap();
        let args = CorpusArgs {
            output: Some(state.path().join("new-campaign")),
            profile: "shenron".into(),
            state: Some(state.path().to_path_buf()),
            json: true,
        };
        let report = index_existing(&args, &[catalogue]).await.unwrap();
        assert_eq!(report["materialized"], 1);
        assert_eq!(report["index"]["indexed"], 1);
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("shenron".into())).unwrap();
        let db = aphrody_rag::home::HomeDb::open_read_only(&layout.db_path).unwrap();
        assert!(
            !aphrody_rag::home::unified_search(&db, "CatalogueFixtureGohan", &Default::default())
                .unwrap()
                .is_empty()
        );
    }
}
