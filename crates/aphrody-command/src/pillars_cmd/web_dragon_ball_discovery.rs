// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball discovery composes the existing Google and Web detection owners.

use super::{CampaignArgs, CorpusArgs};
use aphrody_google::search::{GoogleVertical, SearchOptions, SearchTransport};
use aphrody_web_crawl::dragon_ball::{DragonBallPlan, validate_source_url};
use clap::Args;
use miette::{IntoDiagnostic, miette};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::path::Path;
use std::{collections::BTreeSet, future::Future};

const WEB_QUERIES: [&str; 3] = [
    "site:dragon-ball-official.com Dragon Ball",
    "site:lineup.toei-anim.co.jp ドラゴンボール",
    "site:kanzenshuu.com Toriyama interview",
];
const QUERIES: [&str; 3] = [
    "Dragon Ball Akira Toriyama",
    "ドラゴンボール 鳥山明",
    "Dragon Ball officiel Toei",
];

#[derive(Debug, Args)]
pub(crate) struct DiscoveryArgs {
    #[command(flatten)]
    corpus: CorpusArgs,
    #[arg(long)]
    config: Option<std::path::PathBuf>,
    #[arg(long = "source", value_delimiter = ',')]
    sources: Vec<String>,
    #[arg(long)]
    force: bool,
    /// Maximum owner operations; an owner can use its bounded native fallback
    #[arg(long, default_value_t = 128, value_parser = clap::value_parser!(u32).range(1..=5000))]
    max_operations: u32,
    /// Results per Google surface (historical default: 50)
    #[arg(long,default_value_t=50,value_parser=clap::value_parser!(u8).range(1..=100))]
    num: u8,
    /// Leave optional root technology observations for another run
    #[arg(long)]
    skip_frameworks: bool,
}

struct Budget {
    used: usize,
    limit: usize,
    errors: Map<String, Value>,
}
impl Budget {
    async fn recover<T: Serialize>(
        &mut self,
        name: &str,
        future: impl Future<Output = Result<T, String>>,
        empty: Value,
    ) -> Value {
        if self.used >= self.limit {
            self.errors
                .insert(name.into(), json!("discovery operation budget exhausted"));
            return empty;
        }
        self.used += 1;
        match future.await {
            Ok(value) => match serde_json::to_value(value) {
                Ok(value) => value,
                Err(error) => {
                    self.errors.insert(name.into(), json!(error.to_string()));
                    empty
                }
            },
            Err(error) => {
                self.errors.insert(name.into(), json!(error));
                empty
            }
        }
    }
    fn envelope(&self, name: &str, data: &Value) -> Value {
        match self.errors.get(name) {
            Some(error) => json!({"status":"error","error":error}),
            None => json!({"status":"ok","data":data}),
        }
    }
}

fn save(output: &Path, name: &str, data: &Value) -> miette::Result<()> {
    super::super::crawl_index::write_private(
        &output.join(name),
        &serde_json::to_vec_pretty(data).into_diagnostic()?,
    )
}

fn seeds(values: impl Iterator<Item = String>, allowed: &BTreeSet<String>) -> Vec<String> {
    values
        .filter_map(|raw| {
            let url = validate_source_url(&raw).ok()?;
            allowed.contains(url.host_str()?).then_some(url.to_string())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn asset_projection(query: &str, images: &Value) -> Value {
    let results:Vec<_>=images.as_array().into_iter().flatten().enumerate().filter_map(|(index,row)|{
        let url=row.get("imageUrl").and_then(Value::as_str).or_else(||row.get("thumbnail").and_then(Value::as_str))?;
        validate_source_url(url).ok()?;
        Some(json!({"id":format!("{index}:{url}"),"kind":"image","provider":"google-images","title":row["title"],"url":url,"previewUrl":row.get("thumbnail"),"pageUrl":row.get("source").and_then(Value::as_str).filter(|value|!value.is_empty()),"width":Value::Null,"height":Value::Null,"attribution":"Google Images result; follow the source page for rights and attribution"}))
    }).collect();
    json!({"query":query,"kind":"image","providers":[{"provider":"google-images","status":if results.is_empty(){"empty"}else{"ok"},"count":results.len()}],"results":results,"cache":"miss","offset":0,"nextOffset":Value::Null})
}

pub(super) async fn run(args: DiscoveryArgs) -> miette::Result<Value> {
    let campaign = CampaignArgs {
        corpus: args.corpus,
        config: args.config,
        sources: args.sources,
        max_requests: None,
        max_depth: None,
        with_gallery: false,
        force: args.force,
        discovery_plan: None,
        render: false,
    };
    let layout = super::layout(&campaign.corpus)?;
    let output = super::output(&campaign.corpus, &layout);
    let (plan, options) = super::campaign(&campaign, output.clone())?;
    let targets = plan
        .selected_targets(&options.sources)
        .map_err(|error| miette!("discovery selection: {error}"))?;
    let mut allowed = BTreeSet::new();
    let mut roots = BTreeSet::new();
    for target in targets {
        for domain in &target.allowed_domains {
            allowed.insert(domain.to_ascii_lowercase());
        }
        for seed in &target.seeds {
            let url = validate_source_url(seed)
                .map_err(|error| miette!("invalid discovery root: {error}"))?;
            allowed.insert(url.host_str().unwrap_or_default().to_owned());
            roots.insert(url.to_string());
        }
    }
    super::super::crawl_index::private_directory(&output)?;
    let _lock = super::super::crawl_index::job_lock(&output)?;
    let mut budget = Budget {
        used: 0,
        limit: usize::try_from(args.max_operations).into_diagnostic()?,
        errors: Map::new(),
    };
    let mut search = SearchOptions {
        num: Some(args.num),
        anonymous: true,
        transport: SearchTransport::Auto,
        ..Default::default()
    };
    let mut candidates = Vec::new();
    let mut web = Vec::new();
    for (index, query) in WEB_QUERIES.iter().enumerate() {
        let report = budget
            .recover(
                &format!("web:{index}"),
                aphrody_google::search::search_rich(query, &search),
                json!({}),
            )
            .await;
        if let Some(results) = report.get("organic").and_then(Value::as_array) {
            candidates.extend(
                results
                    .iter()
                    .filter_map(|item| item.get("url").and_then(Value::as_str))
                    .map(str::to_owned),
            );
        }
        web.push(report);
    }
    let books = budget
        .recover(
            "books",
            aphrody_google::search::search_books(QUERIES[0], 40, &search),
            json!({}),
        )
        .await;
    if let Some(error) = books.get("apiError") {
        budget.errors.insert("books-api".into(), error.clone());
    }
    save(
        &output,
        "google-books.json",
        &budget.envelope("books", &books),
    )?;
    let mut suggestions = BTreeSet::new();
    for (index, query) in QUERIES.iter().enumerate() {
        let result = budget
            .recover(
                &format!("suggestions:{index}"),
                aphrody_google::search::autocomplete(query, "en"),
                json!([]),
            )
            .await;
        suggestions.extend(
            result
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned),
        );
    }
    let suggestions = json!(suggestions);
    let suggestion_error = budget
        .errors
        .iter()
        .find(|(key, _)| key.starts_with("suggestions:"))
        .map(|(_, error)| error.clone());
    save(
        &output,
        "google-suggest.json",
        &suggestion_error.map_or_else(
            || json!({"status":"ok","data":suggestions}),
            |error| json!({"status":"error","error":error,"data":suggestions}),
        ),
    )?;
    let news = budget
        .recover(
            "news",
            aphrody_google::search::search_vertical(QUERIES[0], GoogleVertical::News, &search),
            json!([]),
        )
        .await;
    search.hl = "ja".into();
    let videos = budget
        .recover(
            "videos",
            aphrody_google::search::search_vertical(QUERIES[1], GoogleVertical::Videos, &search),
            json!([]),
        )
        .await;
    search.hl = "en".into();
    let scholar = budget
        .recover(
            "scholar",
            aphrody_google::search::search_vertical(QUERIES[0], GoogleVertical::Scholar, &search),
            json!([]),
        )
        .await;
    let images = budget
        .recover(
            "images",
            aphrody_google::search::search_vertical(QUERIES[0], GoogleVertical::Images, &search),
            json!([]),
        )
        .await;
    for value in [&news, &videos, &scholar] {
        candidates.extend(
            value
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("url").and_then(Value::as_str))
                .map(str::to_owned),
        );
    }
    let assets = asset_projection(QUERIES[0], &images);
    save(&output, "assets.json", &budget.envelope("images", &assets))?;
    let mut dns = Map::new();
    for domain in &allowed {
        dns.insert(
            domain.clone(),
            budget
                .recover(
                    &format!("dns:{domain}"),
                    aphrody_google::search::resolve_dns(domain),
                    json!({}),
                )
                .await,
        );
    }
    let mut frameworks = Vec::new();
    if !args.skip_frameworks {
        for url in &roots {
            let name = format!("framework:{url}");
            let report = budget
                .recover(
                    &name,
                    async {
                        aphrody_web_detect::detect_url(url)
                            .await
                            .map_err(|error| error.to_string())
                    },
                    Value::Null,
                )
                .await;
            if let Some(error) = budget.errors.get(&name) {
                frameworks.push(json!({"url":url,"status":"error","error":error}));
            } else {
                frameworks.push(json!({"url":url,"status":"ok","technologies":report["findings"],"detection":report}));
            }
        }
    }
    save(
        &output,
        "frameworks.json",
        &json!({"status":"ok","data":frameworks}),
    )?;
    let urls = seeds(candidates.into_iter(), &allowed);
    let discovery = json!({"queries":QUERIES,"books":books,"suggestions":suggestions,"news":news,"videos":videos,"scholar":scholar,"dns":dns,"errors":budget.errors,"web":web,"images":images});
    save(
        &output,
        "google-discovery.json",
        &json!({"status":"ok","data":discovery}),
    )?;
    let modules = [
        "google-books.json",
        "google-suggest.json",
        "google-discovery.json",
        "assets.json",
        "archive-drslump.json",
        "wiki-toriyama.json",
        "frameworks.json",
    ];
    let unified = json!({"schema":"bxc-dragonball-unified-pipeline/v1","roots":roots,"googleUrls":urls,"allowedDomains":allowed,"modules":modules,"storage":output,"storageDir":output.join("storage"),"databasePath":output.join("bxc.sqlite")});
    save(&output, "discovery-plan.json", &unified)?;
    let report = json!({"mode":"discover","profile":campaign.corpus.profile,"completed":budget.errors.is_empty(),"operations":budget.used,"operationBudget":budget.limit,"plan":unified,"discovery":discovery,"frameworks":frameworks,"assets":assets});
    save(&output, "discovery-report.json", &report)?;
    Ok(report)
}

/// Attach only exact registry-owned, editorially allowed discovered URLs to
/// the selected campaign targets. No foreign domain can expand a native crawl.
pub(super) fn extend_plan(plan: &mut DragonBallPlan, path: &Path) -> miette::Result<usize> {
    let value: Value =
        serde_json::from_slice(&std::fs::read(path).into_diagnostic()?).into_diagnostic()?;
    if value.get("schema").and_then(Value::as_str) != Some("bxc-dragonball-unified-pipeline/v1") {
        return Err(miette!("invalid discovery plan schema"));
    }
    let urls = value
        .get("googleUrls")
        .and_then(Value::as_array)
        .ok_or_else(|| miette!("discovery plan has no googleUrls"))?;
    let mut added = 0;
    for raw in urls {
        let raw = raw
            .as_str()
            .ok_or_else(|| miette!("discovered URL must be text"))?;
        let url =
            validate_source_url(raw).map_err(|error| miette!("invalid discovered URL: {error}"))?;
        for target in &mut plan.targets {
            if target.enabled
                && target
                    .allowed_domains
                    .iter()
                    .any(|domain| Some(domain.as_str()) == url.host_str())
                && target.accepts(&url)
                && !target.seeds.iter().any(|seed| seed == url.as_str())
            {
                target.seeds.push(url.to_string());
                added += 1;
            }
        }
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_seeds_require_exact_hosts_and_editorial_policy() {
        let allowed = BTreeSet::from(["dragon-ball-official.com".into(), "fandom.com".into()]);
        let result = seeds(
            [
                "https://dragon-ball-official.com/news",
                "https://unowned.dragon-ball-official.com/article",
                "https://dragonball.fandom.com/wiki/Goku",
                "https://user:password@dragon-ball-official.com/private",
                "https://dragon-ball-official.com/news",
            ]
            .into_iter()
            .map(str::to_owned),
            &allowed,
        );
        assert_eq!(result, vec!["https://dragon-ball-official.com/news"]);
    }
    #[tokio::test]
    async fn operation_budget_never_polls_an_unaccepted_operation() {
        let mut budget = Budget {
            used: 0,
            limit: 0,
            errors: Map::new(),
        };
        let result = budget
            .recover(
                "late",
                async {
                    panic!("exhausted operation was polled");
                    #[allow(unreachable_code)]
                    Ok::<usize, String>(1)
                },
                Value::Null,
            )
            .await;
        assert!(result.is_null());
        assert_eq!(budget.used, 0);
        assert!(budget.errors.contains_key("late"));
    }
}
