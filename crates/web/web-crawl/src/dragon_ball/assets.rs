// SPDX-License-Identifier: Apache-2.0
//! DragonBallCN acquisition migrated from Shenron's cover/plate workers.
//! Existing Obscura HTTP owns cookies, proxy, redirects and referrer semantics.
use super::documents::write_private;
use super::{sha256, validate_source_url};
use obscura_net::{ObscuraHttpClient, ResourceRequest, ResourceType};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    time::{Duration, Instant},
};
use url::Url;

#[derive(Clone, Debug)]
pub struct DragonBallAssetOptions {
    pub output: PathBuf,
    pub max_files: usize,
    pub plates: bool,
    pub quality: f32,
    pub lossless: bool,
    pub force: bool,
    pub delay_ms: u64,
    pub max_response_bytes: usize,
    pub min_free_bytes: u64,
    pub collection: Option<String>,
    pub did: Option<String>,
    pub local_reserve: Option<PathBuf>,
    pub grayscale: bool,
    pub max_width: Option<u32>,
    pub requests: Vec<DragonBallImageRequest>,
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DragonBallImageRequest {
    pub url: String,
    pub referrer: String,
    /// Relative protected output path; traversal and absolute paths are rejected.
    pub path: PathBuf,
}

impl DragonBallAssetOptions {
    pub fn new(output: PathBuf) -> Self {
        Self {
            output,
            max_files: 300,
            plates: false,
            quality: 82.0,
            lossless: false,
            force: false,
            delay_ms: 1200,
            max_response_bytes: 32 * 1024 * 1024,
            min_free_bytes: 2 * 1024 * 1024 * 1024,
            collection: None,
            did: None,
            local_reserve: None,
            grayscale: false,
            max_width: None,
            requests: Vec::new(),
            reference: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
struct AssetJournal {
    files: BTreeMap<String, AcquiredAsset>,
    request_times: Vec<i64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AcquiredAsset {
    pub url: String,
    pub path: PathBuf,
    pub source_path: PathBuf,
    pub bytes: usize,
    pub checksum: String,
    pub source_checksum: String,
    #[serde(default)]
    pub source_sha256: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DragonBallAssetReport {
    pub schema: String,
    pub completed: bool,
    pub downloaded: usize,
    pub reused: usize,
    pub pending: usize,
    pub requests: usize,
    pub files: Vec<AcquiredAsset>,
    pub errors: Vec<(String, String)>,
    pub journal: PathBuf,
}

pub struct AssetResponse {
    pub url: Url,
    pub status: u16,
    pub bytes: Vec<u8>,
}
#[allow(async_fn_in_trait)]
pub trait DragonBallAssetTransport {
    async fn get(
        &self,
        url: &Url,
        referrer: &Url,
        max_bytes: usize,
    ) -> Result<AssetResponse, String>;
}

impl DragonBallAssetTransport for ObscuraHttpClient {
    async fn get(
        &self,
        url: &Url,
        referrer: &Url,
        max_bytes: usize,
    ) -> Result<AssetResponse, String> {
        let mut request = ResourceRequest::subresource(ResourceType::Image, referrer)
            .with_max_response_bytes(max_bytes);
        request.referrer = Some(referrer.clone());
        let response = self
            .fetch_resource_with_callbacks(url, request, None)
            .await
            .map_err(|error| error.to_string())?;
        Ok(AssetResponse { url: response.url, status: response.status, bytes: response.body })
    }
}

pub async fn sync_assets(
    client: &ObscuraHttpClient,
    options: &DragonBallAssetOptions,
) -> Result<DragonBallAssetReport, String> {
    sync_assets_with_transport(client, options).await
}

/// Read-only acquisition plan, for dry runs and product approval surfaces.
pub fn plan_asset_requests(
    options: &DragonBallAssetOptions,
) -> Result<Vec<DragonBallImageRequest>, String> {
    Ok(jobs(options)?
        .1
        .into_iter()
        .map(|job| DragonBallImageRequest {
            url: job.url.to_string(),
            referrer: job.referrer.to_string(),
            path: job.path.strip_prefix(&options.output).unwrap_or(&job.path).to_path_buf(),
        })
        .collect())
}

/// Acquire declared public reader images. OCR, promotional exclusions,
/// editorial IDs and database mutation stay with the Shenron product.
pub async fn acquire_manga_volume<T: crate::CrawlTransport, A: DragonBallAssetTransport>(
    pages: &T,
    assets: &A,
    volume: u32,
    options: &DragonBallAssetOptions,
) -> Result<DragonBallAssetReport, String> {
    if !(1..=42).contains(&volume) {
        return Err("original manga volume must be between 1 and 42".into());
    }
    let url =
        validate_source_url(&format!("https://sushiscan.fr/dragon-ball-volume-{volume}-vf/"))?;
    let response = pages.fetch(&url).await?;
    validate_source_url(response.url.as_str())?;
    if response.url.host_str() != Some("sushiscan.fr") || response.status != 200 {
        return Err(format!(
            "reader capture refused: HTTP {} or redirect outside source",
            response.status
        ));
    }
    let images = aphrody_web_extract::dragon_ball::parse_reader_images(&response.body)?;
    let mut options = options.clone();
    options.requests = images
        .into_iter()
        .enumerate()
        .map(|(index, url)| DragonBallImageRequest {
            url,
            referrer: response.url.to_string(),
            path: PathBuf::from(format!(
                "assets/manga/DB/regular/vol{volume}/{:03}.webp",
                index + 1
            )),
        })
        .collect();
    if options.requests.is_empty() {
        return Err("reader returned no declared images".into());
    }
    options.grayscale = true;
    options.max_width = Some(1280);
    options.quality = 55.0;
    let report = sync_assets_with_transport(assets, &options).await?;
    write_private(
        &options
            .output
            .join(format!("assets/manga/DB/regular/vol{volume}/acquisition-report.json")),
        &serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )?;
    Ok(report)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssetProbe {
    pub url: String,
    pub status: Option<u16>,
    pub valid_image: bool,
    pub bytes: usize,
    pub error: Option<String>,
}

/// Probe at most three images without copying media. Requests count in quotas.
pub async fn probe_assets<T: DragonBallAssetTransport>(
    transport: &T,
    options: &DragonBallAssetOptions,
) -> Result<Vec<AssetProbe>, String> {
    let (_, jobs) = jobs(options)?;
    let journal_path = options.output.join("assets/dragonballcn/acquisition.json");
    let mut journal: AssetJournal = if journal_path.is_file() {
        serde_json::from_slice(&std::fs::read(&journal_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?
    } else {
        AssetJournal::default()
    };
    let mut result = Vec::new();
    for job in jobs.iter().take(options.max_files.min(3)) {
        let now = chrono::Utc::now().timestamp_millis();
        journal.request_times.retain(|time| now.saturating_sub(*time) < 24 * 60 * 60 * 1000);
        if journal.request_times.len() >= 5000
            || journal
                .request_times
                .iter()
                .filter(|time| now.saturating_sub(**time) < 15 * 60 * 1000)
                .count()
                >= 300
        {
            return Err("asset probe exceeds persistent acquisition quota".into());
        }
        journal.request_times.push(now);
        write_private(
            &journal_path,
            &serde_json::to_vec_pretty(&journal).map_err(|error| error.to_string())?,
        )?;
        let probe = match transport.get(&job.url, &job.referrer, options.max_response_bytes).await {
            Ok(response) => {
                validate_source_url(response.url.as_str())?;
                let valid = response.bytes.len() <= options.max_response_bytes
                    && response.status == 200
                    && image::ImageReader::new(std::io::Cursor::new(&response.bytes))
                        .with_guessed_format()
                        .is_ok_and(|reader| reader.into_dimensions().is_ok());
                AssetProbe {
                    url: job.url.to_string(),
                    status: Some(response.status),
                    valid_image: valid,
                    bytes: response.bytes.len(),
                    error: None,
                }
            },
            Err(error) => AssetProbe {
                url: job.url.to_string(),
                status: None,
                valid_image: false,
                bytes: 0,
                error: Some(error),
            },
        };
        result.push(probe);
        tokio::time::sleep(Duration::from_millis(options.delay_ms)).await;
    }
    Ok(result)
}

struct AssetJob {
    url: Url,
    referrer: Url,
    path: PathBuf,
    did: String,
    is_cover: bool,
    reserve_path: Option<PathBuf>,
}

fn jobs(options: &DragonBallAssetOptions) -> Result<(Value, Vec<AssetJob>), String> {
    let output = &options.output;
    if !options.requests.is_empty() {
        let mut jobs = Vec::new();
        for request in &options.requests {
            if request.path.as_os_str().is_empty()
                || request
                    .path
                    .components()
                    .any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                return Err("image output must be a safe relative path".into());
            }
            jobs.push(AssetJob {
                url: validate_source_url(&request.url)?,
                referrer: validate_source_url(&request.referrer)?,
                path: output.join(&request.path),
                did: String::new(),
                is_cover: false,
                reserve_path: None,
            });
        }
        return Ok((json!({"collections":[]}), jobs));
    }
    let path = output.join("assets/dragonballcn/index.json");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let inventory_path = output.join("data/catalogues/dragonballcn-inventaire.json");
    let inventory: Value = if inventory_path.is_file() {
        serde_json::from_slice(&std::fs::read(inventory_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?
    } else {
        json!({})
    };
    let mut result = Vec::new();
    for collection in snapshot
        .get("collections")
        .and_then(Value::as_array)
        .ok_or("DragonBallCN snapshot has no collections")?
    {
        let slug =
            collection.get("slug").and_then(Value::as_str).ok_or("collection has no slug")?;
        if options.collection.as_deref().is_some_and(|selected| selected != slug) {
            continue;
        }
        if !slug.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) {
            return Err("unsafe collection slug".into());
        }
        for (index, book) in collection
            .get("ouvrages")
            .and_then(Value::as_array)
            .ok_or("collection has no volumes")?
            .iter()
            .enumerate()
        {
            let did = book.get("did").and_then(Value::as_str).ok_or("volume has no did")?;
            if options.did.as_deref().is_some_and(|selected| selected != did) {
                continue;
            }
            if !did.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                return Err("unsafe volume identifier".into());
            }
            let referrer = validate_source_url(
                book.get("url_fiche")
                    .and_then(Value::as_str)
                    .ok_or("volume has no source fiche")?,
            )?;
            if let Some(raw) = book.pointer("/couverture/source_url").and_then(Value::as_str) {
                let url = validate_source_url(raw)?;
                let extension = url
                    .path()
                    .rsplit('.')
                    .next()
                    .filter(|ext| ext.bytes().all(|byte| byte.is_ascii_alphanumeric()))
                    .unwrap_or("jpg");
                result.push(AssetJob {
                    reserve_path: options
                        .local_reserve
                        .as_ref()
                        .map(|root| root.join(slug).join(format!("{did}.{extension}"))),
                    url,
                    referrer: referrer.clone(),
                    path: output
                        .join("assets/dragonballcn")
                        .join(slug)
                        .join(format!("{:03}.webp", index + 1)),
                    did: did.into(),
                    is_cover: true,
                });
            }
            if options.plates
                && let Some(pages) = inventory.get(did).and_then(Value::as_array)
            {
                for page in pages {
                    let Some(raw) = page.get("image_url").and_then(Value::as_str) else { continue };
                    let n =
                        page.get("n").and_then(Value::as_u64).ok_or("plate has no page number")?;
                    result.push(AssetJob {
                        url: validate_source_url(raw)?,
                        referrer: referrer.clone(),
                        path: output
                            .join("assets/dragonballcn/planches")
                            .join(slug)
                            .join(did)
                            .join(format!("{n:03}.webp")),
                        did: did.into(),
                        is_cover: false,
                        reserve_path: None,
                    });
                }
            }
        }
    }
    Ok((snapshot, result))
}

fn verified(asset: &AcquiredAsset) -> bool {
    std::fs::read(&asset.path)
        .is_ok_and(|bytes| blake3::hash(&bytes).to_hex().as_str() == asset.checksum)
        && std::fs::read(&asset.source_path)
            .is_ok_and(|bytes| blake3::hash(&bytes).to_hex().as_str() == asset.source_checksum)
}

fn encode_webp(
    bytes: Vec<u8>,
    quality: f32,
    lossless: bool,
    grayscale: bool,
    max_width: Option<u32>,
) -> Result<Vec<u8>, String> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20000);
    limits.max_image_height = Some(20000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let mut image = reader
        .decode()
        .map_err(|error| format!("source is not a valid supported image: {error}"))?;
    if grayscale {
        image = image.grayscale();
    }
    if let Some(width) = max_width.filter(|width| *width > 0)
        && image.width() > width
    {
        let height =
            u32::try_from(u64::from(image.height()) * u64::from(width) / u64::from(image.width()))
                .map_err(|error| error.to_string())?
                .max(1);
        image = image.resize_exact(width, height, image::imageops::FilterType::Lanczos3);
    }
    let image = image.to_rgba8();
    let encoder = webp::Encoder::from_rgba(&image, image.width(), image.height());
    let output = if lossless { encoder.encode_lossless() } else { encoder.encode(quality) };
    Ok(output.to_vec())
}

/// Acquire named catalogue assets with durable hash-verified resume, disk and
/// historic per-window/day limits. Full plates require the explicit option.
pub async fn sync_assets_with_transport<T: DragonBallAssetTransport>(
    transport: &T,
    options: &DragonBallAssetOptions,
) -> Result<DragonBallAssetReport, String> {
    if !options.quality.is_finite() || !(0.0..=100.0).contains(&options.quality) {
        return Err("WebP quality must be between 0 and 100".into());
    }
    let (mut snapshot, jobs) = jobs(options)?;
    std::fs::create_dir_all(&options.output).map_err(|error| error.to_string())?;
    let journal_path = options.output.join("assets/dragonballcn/acquisition.json");
    let mut journal: AssetJournal = if journal_path.is_file() {
        serde_json::from_slice(&std::fs::read(&journal_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?
    } else {
        AssetJournal::default()
    };
    let mut report = DragonBallAssetReport {
        schema: "aphrody-dragonballcn-assets/v1".into(),
        completed: false,
        downloaded: 0,
        reused: 0,
        pending: 0,
        requests: 0,
        files: Vec::new(),
        errors: Vec::new(),
        journal: journal_path.clone(),
    };
    let mut last_request: Option<Instant> = None;
    let mut refusals = 0;
    for job in &jobs {
        let key = job.path.display().to_string();
        if !options.force
            && let Some(asset) = journal.files.get(&key)
            && verified(asset)
        {
            report.reused += 1;
            report.files.push(asset.clone());
            continue;
        }
        let local = job
            .reserve_path
            .as_ref()
            .filter(|path| path.is_file())
            .map(|path| std::fs::read(path).map_err(|error| error.to_string()))
            .transpose()?;
        if report.requests >= options.max_files && local.is_none() {
            report.pending += 1;
            continue;
        }
        if fs4::available_space(&options.output).map_err(|error| error.to_string())?
            < options.min_free_bytes
        {
            return Err("DragonBallCN acquisition paused: insufficient free disk space".into());
        }
        let mut acquired = None;
        for _ in 0..3 {
            let response = if let Some(bytes) = &local {
                AssetResponse { url: job.url.clone(), status: 200, bytes: bytes.clone() }
            } else {
                let now = chrono::Utc::now().timestamp_millis();
                journal
                    .request_times
                    .retain(|time| now.saturating_sub(*time) < 24 * 60 * 60 * 1000);
                if journal.request_times.len() >= 5000
                    || journal
                        .request_times
                        .iter()
                        .filter(|time| now.saturating_sub(**time) < 15 * 60 * 1000)
                        .count()
                        >= 300
                    || report.requests >= options.max_files
                {
                    break;
                }
                if let Some(previous) = last_request {
                    let delay = Duration::from_millis(options.delay_ms);
                    if previous.elapsed() < delay {
                        tokio::time::sleep(delay - previous.elapsed()).await;
                    }
                }
                last_request = Some(Instant::now());
                journal.request_times.push(chrono::Utc::now().timestamp_millis());
                report.requests += 1;
                write_private(
                    &journal_path,
                    &serde_json::to_vec_pretty(&journal).map_err(|error| error.to_string())?,
                )?;
                match transport.get(&job.url, &job.referrer, options.max_response_bytes).await {
                    Ok(response) => response,
                    Err(error) => {
                        report.errors.push((job.url.to_string(), error));
                        continue;
                    },
                }
            };
            validate_source_url(response.url.as_str())?;
            if response.status == 403 || response.status == 429 {
                refusals += 1;
                report.errors.push((
                    job.url.to_string(),
                    format!("source refused acquisition with HTTP {}", response.status),
                ));
                break;
            }
            if !(200..300).contains(&response.status) {
                report
                    .errors
                    .push((job.url.to_string(), format!("asset HTTP {}", response.status)));
                continue;
            }
            if response.bytes.len() > options.max_response_bytes {
                return Err("asset exceeds response byte limit".into());
            }
            refusals = 0;
            let source_checksum = blake3::hash(&response.bytes).to_hex().to_string();
            let source_sha256 = super::sha256_bytes(&response.bytes);
            let source_path = options
                .output
                .join("assets/dragonballcn/source")
                .join(format!("{}.image", sha256(job.url.as_str())));
            write_private(&source_path, &response.bytes)?;
            let quality = options.quality;
            let lossless = options.lossless;
            let grayscale = options.grayscale;
            let max_width = options.max_width;
            let encoded = tokio::task::spawn_blocking(move || {
                encode_webp(response.bytes, quality, lossless, grayscale, max_width)
            })
            .await
            .map_err(|error| error.to_string())??;
            write_private(&job.path, &encoded)?;
            let (width, height) = image::ImageReader::new(std::io::Cursor::new(&encoded))
                .with_guessed_format()
                .map_err(|error| error.to_string())?
                .into_dimensions()
                .map_err(|error| error.to_string())?;
            acquired = Some(AcquiredAsset {
                url: job.url.to_string(),
                path: job.path.clone(),
                source_path,
                bytes: encoded.len(),
                checksum: blake3::hash(&encoded).to_hex().to_string(),
                source_checksum,
                source_sha256,
                sha256: super::sha256_bytes(&encoded),
                width,
                height,
            });
            break;
        }
        if let Some(asset) = acquired {
            journal.files.insert(key, asset.clone());
            report.files.push(asset);
            report.downloaded += 1;
            write_private(
                &journal_path,
                &serde_json::to_vec_pretty(&journal).map_err(|error| error.to_string())?,
            )?;
        } else {
            report.pending += 1;
        }
        if refusals >= 5 {
            report.pending +=
                jobs.len().saturating_sub(report.downloaded + report.reused + report.pending);
            break;
        }
    }
    for collection in snapshot
        .get_mut("collections")
        .and_then(Value::as_array_mut)
        .ok_or("snapshot lost collections")?
    {
        let slug = collection
            .get("slug")
            .and_then(Value::as_str)
            .ok_or("collection lost slug")?
            .to_owned();
        for book in collection
            .get_mut("ouvrages")
            .and_then(Value::as_array_mut)
            .ok_or("snapshot lost volumes")?
        {
            let did = book.get("did").and_then(Value::as_str).unwrap_or_default();
            let plate_directory =
                options.output.join("assets/dragonballcn/planches").join(&slug).join(did);
            let plate_jobs: Vec<_> = jobs
                .iter()
                .filter(|job| {
                    job.did == did
                        && !job.is_cover
                        && job.path.parent() == Some(plate_directory.as_path())
                })
                .collect();
            if options.plates && !plate_jobs.is_empty() {
                let acquired: Vec<_> = plate_jobs
                    .iter()
                    .filter_map(|job| journal.files.get(&job.path.display().to_string()))
                    .filter(|asset| verified(asset))
                    .collect();
                let mut numbers: Vec<_> = acquired
                    .iter()
                    .filter_map(|asset| {
                        asset
                            .path
                            .file_stem()
                            .and_then(|value| value.to_str())
                            .and_then(|value| value.parse::<u64>().ok())
                    })
                    .collect();
                numbers.sort_unstable();
                numbers.dedup();
                let index = json!({"did":did,"collection":slug,"titre":book.get("titre"),"url_fiche":book.get("url_fiche"),"dossier_distant":book.get("dossier_distant"),"reference":options.reference,"rapatrie_le":chrono::Utc::now().to_rfc3339(),"planches":numbers,"files":acquired,"completed":acquired.len()==plate_jobs.len(),"rights_status":"unverified","owner":"aphrody-web-crawl"});
                write_private(
                    &plate_directory.join("index.json"),
                    &serde_json::to_vec_pretty(&index).map_err(|error| error.to_string())?,
                )?;
            }
            if let Some(job) = jobs.iter().find(|job| job.did == did && job.is_cover)
                && let Some(asset) = journal.files.get(&job.path.display().to_string())
                && verified(asset)
            {
                let relative = asset
                    .path
                    .strip_prefix(options.output.join("assets/dragonballcn"))
                    .map_err(|error| error.to_string())?;
                if let Some(cover) = book.get_mut("couverture").and_then(Value::as_object_mut) {
                    cover.insert("path".into(), json!(relative));
                    cover.insert("checksum".into(), json!(asset.checksum));
                    cover.insert(
                        "chemin".into(),
                        json!(format!("./assets/dragonballcn/{}", relative.display())),
                    );
                    cover.insert("sha256".into(), json!(asset.sha256));
                    cover.insert("octets".into(), json!(asset.bytes));
                    cover.insert("largeur".into(), json!(asset.width));
                    cover.insert("hauteur".into(), json!(asset.height));
                }
            }
        }
    }
    if options.requests.is_empty() {
        let covers = snapshot
            .get("collections")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .flat_map(|collection| {
                collection.get("ouvrages").and_then(Value::as_array).into_iter().flatten()
            })
            .filter(|book| book.pointer("/couverture/sha256").and_then(Value::as_str).is_some())
            .count();
        if let Some(totals) = snapshot.get_mut("totaux").and_then(Value::as_object_mut) {
            totals.insert("couvertures".into(), json!(covers));
        }
        snapshot["miroir_le"] = json!(chrono::Utc::now().to_rfc3339());
        write_private(
            &options.output.join("assets/dragonballcn/index.json"),
            &serde_json::to_vec_pretty(&snapshot).map_err(|error| error.to_string())?,
        )?;
    }
    report.completed = report.pending == 0 && report.errors.is_empty();
    write_private(
        &options.output.join("assets/dragonballcn/acquisition-report.json"),
        &serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        bytes: Vec<u8>,
        calls: std::cell::Cell<usize>,
    }
    impl DragonBallAssetTransport for Fixture {
        async fn get(
            &self,
            url: &Url,
            _referrer: &Url,
            _max_bytes: usize,
        ) -> Result<AssetResponse, String> {
            self.calls.set(self.calls.get() + 1);
            Ok(AssetResponse { url: url.clone(), status: 200, bytes: self.bytes.clone() })
        }
    }
    #[tokio::test]
    async fn images_convert_natively_and_resume_only_after_checksum_verification() {
        let output =
            std::env::temp_dir().join(format!("aphrody-dragon-ball-assets-{}", std::process::id()));
        write_private(&output.join("assets/dragonballcn/index.json"),br#"{"collections":[{"slug":"dragonball_jp_original","ouvrages":[{"did":"0-1","url_fiche":"https://comic.dragonballcn.com/list/gain_1.php?did=0-1","couverture":{"source_url":"https://comic.dragonballcn.com/one.png"}}]}]}"#).unwrap();
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let fixture = Fixture { bytes: encoded.into_inner(), calls: std::cell::Cell::new(0) };
        let mut options = DragonBallAssetOptions::new(output.clone());
        options.delay_ms = 0;
        options.min_free_bytes = 0;
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert!(report.completed);
        assert_eq!(report.downloaded, 1);
        assert_eq!(fixture.calls.get(), 1);
        assert_eq!(
            image::guess_format(&std::fs::read(&report.files[0].path).unwrap()).unwrap(),
            image::ImageFormat::WebP
        );
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert_eq!(report.reused, 1);
        assert_eq!(fixture.calls.get(), 1);
        std::fs::write(&report.files[0].path, b"corrupt").unwrap();
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert_eq!(report.downloaded, 1);
        assert_eq!(fixture.calls.get(), 2);
        let snapshot: Value = serde_json::from_slice(
            &std::fs::read(output.join("assets/dragonballcn/index.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(snapshot["collections"][0]["ouvrages"][0]["couverture"]["largeur"], 2);
        assert_eq!(
            snapshot["collections"][0]["ouvrages"][0]["couverture"]["sha256"],
            report.files[0].sha256
        );
        std::fs::remove_dir_all(output).unwrap();
    }

    #[tokio::test]
    async fn reserve_filters_and_generic_grayscale_resize_preserve_sources() {
        let output = std::env::temp_dir()
            .join(format!("aphrody-dragon-ball-reserve-{}", std::process::id()));
        write_private(&output.join("assets/dragonballcn/index.json"),br#"{"collections":[{"slug":"edition","ouvrages":[{"did":"0-1","url_fiche":"https://comic.dragonballcn.com/list/gain_1.php?did=0-1","couverture":{"source_url":"https://comic.dragonballcn.com/one.png"}}]}]}"#).unwrap();
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            16,
            8,
            image::Rgb([200, 50, 30]),
        ));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let bytes = bytes.into_inner();
        let reserve = output.join("reserve");
        write_private(&reserve.join("edition/0-1.png"), &bytes).unwrap();
        let fixture = Fixture { bytes: bytes.clone(), calls: std::cell::Cell::new(0) };
        let mut options = DragonBallAssetOptions::new(output.clone());
        options.delay_ms = 0;
        options.min_free_bytes = 0;
        options.local_reserve = Some(reserve);
        options.collection = Some("edition".into());
        options.did = Some("0-1".into());
        options.max_files = 0;
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert!(report.completed);
        assert_eq!(fixture.calls.get(), 0);
        assert_eq!(std::fs::read(&report.files[0].source_path).unwrap(), bytes);
        options.requests = vec![DragonBallImageRequest {
            url: "https://cdn.example.org/page.png".into(),
            referrer: "https://sushiscan.fr/".into(),
            path: PathBuf::from("assets/manga/page.webp"),
        }];
        options.max_files = 1;
        options.grayscale = true;
        options.max_width = Some(8);
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert!(report.completed);
        assert_eq!(report.files[0].width, 8);
        assert_eq!(report.files[0].height, 4);
        let decoded = image::open(&report.files[0].path).unwrap().to_rgb8();
        let pixel = decoded.get_pixel(0, 0);
        assert_eq!(pixel[0], pixel[1]);
        assert_eq!(pixel[1], pixel[2]);
        options.requests[0].path = PathBuf::from("../outside.webp");
        assert!(plan_asset_requests(&options).is_err());
        std::fs::remove_dir_all(output).unwrap();
    }

    #[tokio::test]
    async fn plate_manifest_keeps_legacy_three_digit_names_and_acquired_numbers() {
        let output = std::env::temp_dir()
            .join(format!("aphrody-dragon-ball-plate-manifest-{}", std::process::id()));
        write_private(&output.join("assets/dragonballcn/index.json"),br#"{"collections":[{"slug":"edition","ouvrages":[{"did":"0-1","titre":"Source book","url_fiche":"https://comic.dragonballcn.com/list/gain_1.php?did=0-1","dossier_distant":"db/source","couverture":null}]}]}"#).unwrap();
        write_private(&output.join("data/catalogues/dragonballcn-inventaire.json"),br#"{"0-1":[{"n":1,"fichier":"one.png","image_url":"https://comic.dragonballcn.com/list/db/source/one.png"},{"n":2,"fichier":"two.png","image_url":"https://comic.dragonballcn.com/list/db/source/two.png"}]}"#).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let fixture = Fixture { bytes: bytes.into_inner(), calls: std::cell::Cell::new(0) };
        let mut options = DragonBallAssetOptions::new(output.clone());
        options.plates = true;
        options.delay_ms = 0;
        options.min_free_bytes = 0;
        options.max_files = 1;
        options.reference = Some("editorial-source-reference".into());
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert!(!report.completed);
        assert_eq!(report.pending, 1);
        let directory = output.join("assets/dragonballcn/planches/edition/0-1");
        assert!(directory.join("001.webp").is_file());
        assert!(!directory.join("0001.webp").exists());
        let index: Value =
            serde_json::from_slice(&std::fs::read(directory.join("index.json")).unwrap()).unwrap();
        assert_eq!(index["planches"], json!([1]));
        assert_eq!(index["reference"], "editorial-source-reference");
        assert_eq!(index["dossier_distant"], "db/source");
        assert_eq!(index["completed"], false);
        options.max_files = 2;
        let report = sync_assets_with_transport(&fixture, &options).await.unwrap();
        assert!(report.completed);
        assert_eq!(report.reused, 1);
        assert_eq!(fixture.calls.get(), 2);
        let index: Value =
            serde_json::from_slice(&std::fs::read(directory.join("index.json")).unwrap()).unwrap();
        assert_eq!(index["planches"], json!([1, 2]));
        assert_eq!(index["completed"], true);
        std::fs::remove_dir_all(output).unwrap();
    }
}
