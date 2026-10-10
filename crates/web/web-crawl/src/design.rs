// SPDX-License-Identifier: Apache-2.0
//! Acquire the published Material Design Carbon catalog without executing its
//! JavaScript. Documents retain their raw JSON and every section/tab; Markdown
//! is produced by Aphrody's canonical HTML converter, not an inferred spec.

use std::{collections::BTreeMap, path::Path, time::Duration};

use aphrody_web_extract::html_to_markdown;
use futures::{StreamExt, stream};
use obscura_dom::parse_html;
use obscura_net::{ObscuraHttpClient, ResourceRequest, ResourceType};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use crate::mirror::{local_relative_path, safe_write};

const SOURCE: &str = "https://m3.material.io/";
const MAX_DOCS: usize = 2_000;
const MAX_CONCURRENCY: usize = 32;
const MAX_BODY: usize = 16 * 1024 * 1024;
const MAX_BUNDLES: usize = 8;
const MAX_ASSETS: usize = 20_000;

/// One actual fetched source with an immutable content fingerprint.
#[derive(Clone, Debug, Serialize)]
pub struct MaterialSource {
    pub url: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// One acquired structured document and its extracted counterpart.
#[derive(Clone, Debug, Serialize)]
pub struct MaterialDocument {
    pub slug: String,
    /// All catalog routes sharing this Carbon file, including tab routes.
    pub slugs: Vec<String>,
    pub source_url: String,
    pub raw_path: String,
    pub markdown_path: String,
    pub sha256: String,
    pub markdown_sha256: String,
    pub title: String,
    pub sections: usize,
}

/// Every catalog file, including files omitted by the requested acquisition
/// budget. Its optional acquired entry is linked by source_url.
#[derive(Clone, Debug, Serialize)]
pub struct MaterialCatalogEntry {
    pub file_id: String,
    pub slugs: Vec<String>,
    pub source_url: String,
}

/// A failed fetch, validation, extraction or write. Partial runs remain honest.
#[derive(Clone, Debug, Serialize)]
pub struct MaterialFailure {
    pub url: String,
    pub error: String,
}

/// AI-ready acquisition receipt; paths are relative to the supplied output.
#[derive(Clone, Debug, Serialize)]
pub struct MaterialSyncReport {
    pub source_url: String,
    pub carbon_version: String,
    pub catalog_routes: usize,
    pub catalog_documents: usize,
    pub requested_documents: usize,
    pub documents_written: usize,
    pub requests: usize,
    pub bytes_written: u64,
    pub max_docs: usize,
    pub concurrency: usize,
    pub truncated: bool,
    pub assets_truncated: bool,
    pub sources: Vec<MaterialSource>,
    pub catalog: Vec<MaterialCatalogEntry>,
    pub entries: Vec<MaterialDocument>,
    pub failures: Vec<MaterialFailure>,
    /// Public embedded media URLs for the existing static mirror's second pass.
    pub assets: Vec<Url>,
    pub receipt_path: String,
    pub catalog_path: String,
    pub assets_path: String,
    pub ai_index_path: String,
}

/// Errors that prevent discovery or prevent a reviewable receipt being saved.
#[derive(Debug)]
pub enum MaterialSyncError {
    InvalidBounds(String),
    Discovery(String),
    Http(String),
    Io(String),
}

impl std::fmt::Display for MaterialSyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidBounds(value) => write!(f, "invalid Material sync bounds: {value}"),
            Self::Discovery(value) => write!(f, "Material catalog discovery failed: {value}"),
            Self::Http(value) => write!(f, "Material HTTP acquisition failed: {value}"),
            Self::Io(value) => write!(f, "Material output failed: {value}"),
        }
    }
}

impl std::error::Error for MaterialSyncError {}

#[derive(Clone, Debug)]
struct CatalogDocument {
    file_id: String,
    slugs: Vec<String>,
}

struct Fetched {
    url: Url,
    body: Vec<u8>,
    attempts: usize,
}

/// Discover the live same-origin application bundle and fetch its public
/// structured document catalog through the existing Obscura HTTP client.
///
/// Each decoded response is limited to 16 MiB and 30 seconds, with at most
/// three attempts. Concurrency is explicit and no JavaScript is evaluated.
///
/// # Errors
/// Invalid limits, unavailable/changed bootstrap schema, or output/receipt IO.
pub async fn sync_material(
    client: &ObscuraHttpClient,
    output: &Path,
    max_docs: usize,
    concurrency: usize,
) -> Result<MaterialSyncReport, MaterialSyncError> {
    validate_bounds(output, max_docs, concurrency)?;
    tokio::fs::create_dir_all(output).await.map_err(io_error)?;
    let seed = Url::parse(SOURCE).expect("constant source URL");
    let bootstrap =
        fetch(client, &seed).await.map_err(|(error, _)| MaterialSyncError::Http(error))?;
    let scripts = discover_bundles(&String::from_utf8_lossy(&bootstrap.body), &bootstrap.url)?;
    let mut sources = vec![save_source(output, &bootstrap).await?];
    let mut requests = bootstrap.attempts;
    let mut version = None;
    let mut catalog = BTreeMap::<String, Vec<String>>::new();
    for script in scripts {
        let bundle =
            fetch(client, &script).await.map_err(|(error, _)| MaterialSyncError::Http(error))?;
        requests += bundle.attempts;
        let (bundle_version, entries) = discover_catalog(&String::from_utf8_lossy(&bundle.body))?;
        if version.as_ref().is_some_and(|value| value != &bundle_version) {
            return Err(MaterialSyncError::Discovery(
                "conflicting Carbon versions in bundles".into(),
            ));
        }
        version = Some(bundle_version);
        for entry in entries {
            let slugs = catalog.entry(entry.file_id).or_default();
            for slug in entry.slugs {
                if !slugs.contains(&slug) {
                    slugs.push(slug);
                }
            }
        }
        sources.push(save_source(output, &bundle).await?);
    }
    let version =
        version.ok_or_else(|| MaterialSyncError::Discovery("missing Carbon version".into()))?;
    let catalog_routes = catalog.values().map(Vec::len).sum();
    let catalog_documents = catalog.len();
    let complete_catalog = catalog
        .iter()
        .map(|(file_id, slugs)| MaterialCatalogEntry {
            file_id: file_id.clone(),
            slugs: slugs.clone(),
            source_url: seed_url(&format!("/_dsm/content/m3/{version}/{file_id}")).to_string(),
        })
        .collect();
    let selected = catalog
        .into_iter()
        .take(max_docs)
        .map(|(file_id, mut slugs)| {
            slugs.sort_by_key(|slug| (slug.len(), slug.clone()));
            CatalogDocument { file_id, slugs }
        })
        .collect::<Vec<_>>();
    let mut report = MaterialSyncReport {
        source_url: SOURCE.into(),
        carbon_version: version.clone(),
        catalog_routes,
        catalog_documents,
        requested_documents: selected.len(),
        documents_written: 0,
        requests,
        bytes_written: sources.iter().map(|source| source.bytes).sum(),
        max_docs,
        concurrency,
        truncated: catalog_documents > max_docs,
        assets_truncated: false,
        sources,
        catalog: complete_catalog,
        entries: Vec::new(),
        failures: Vec::new(),
        assets: Vec::new(),
        receipt_path: "material-sync-receipt.json".into(),
        catalog_path: "material-catalog.json".into(),
        assets_path: "assets.json".into(),
        ai_index_path: "AI_READY.md".into(),
    };
    let jobs = stream::iter(selected.into_iter().map(|entry| {
        let version = &version;
        async move {
            let url = seed_url(&format!("/_dsm/content/m3/{version}/{}", entry.file_id));
            let fetched = fetch(client, &url).await;
            (entry, url, fetched)
        }
    }))
    .buffer_unordered(concurrency);
    tokio::pin!(jobs);
    let mut assets = BTreeMap::<String, Url>::new();
    while let Some((entry, url, fetched)) = jobs.next().await {
        let fetched = match fetched {
            Ok(value) => {
                report.requests += value.attempts;
                value
            },
            Err((error, attempts)) => {
                report.requests += attempts;
                report.failures.push(MaterialFailure { url: url.to_string(), error });
                continue;
            },
        };
        match save_document(output, &entry, &fetched).await {
            Ok((document, discovered, bytes)) => {
                report.documents_written += 1;
                report.bytes_written += bytes;
                report.entries.push(document);
                for asset in discovered {
                    if assets.len() < MAX_ASSETS || assets.contains_key(asset.as_str()) {
                        assets.insert(asset.to_string(), asset);
                    } else {
                        report.assets_truncated = true;
                    }
                }
            },
            Err(error) => report.failures.push(MaterialFailure { url: url.to_string(), error }),
        }
    }
    report.entries.sort_by(|left, right| left.slug.cmp(&right.slug));
    report.assets = assets.into_values().collect();
    write_indexes(output, &report).await?;
    Ok(report)
}

fn seed_url(path: &str) -> Url {
    Url::parse(SOURCE).expect("constant URL").join(path).expect("validated source path")
}

fn validate_bounds(
    output: &Path,
    max_docs: usize,
    concurrency: usize,
) -> Result<(), MaterialSyncError> {
    if !(1..=MAX_DOCS).contains(&max_docs) || !(1..=MAX_CONCURRENCY).contains(&concurrency) {
        return Err(MaterialSyncError::InvalidBounds(format!(
            "max_docs must be 1..={MAX_DOCS}; concurrency must be 1..={MAX_CONCURRENCY}"
        )));
    }
    if output.as_os_str().is_empty() {
        return Err(MaterialSyncError::InvalidBounds("empty output directory".into()));
    }
    Ok(())
}

fn io_error(error: impl std::fmt::Display) -> MaterialSyncError {
    MaterialSyncError::Io(error.to_string())
}

fn same_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("m3.material.io")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

async fn fetch(client: &ObscuraHttpClient, url: &Url) -> Result<Fetched, (String, usize)> {
    if !same_origin(url) {
        return Err(("source must be credential-free HTTPS on m3.material.io".into(), 0));
    }
    for attempt in 1..=3 {
        let request = ResourceRequest::subresource(ResourceType::Other, url)
            .with_max_response_bytes(MAX_BODY);
        let response = tokio::time::timeout(
            Duration::from_secs(30),
            client.fetch_resource_with_callbacks(url, request, None),
        )
        .await;
        let (error, retry) = match response {
            Ok(Ok(response)) if !same_origin(&response.url) => {
                ("cross-origin redirect rejected".into(), false)
            },
            Ok(Ok(response)) if (200..300).contains(&response.status) => {
                return Ok(Fetched { url: response.url, body: response.body, attempts: attempt });
            },
            Ok(Ok(response)) => (
                format!("HTTP {}", response.status),
                response.status == 429 || response.status >= 500,
            ),
            Ok(Err(error)) => (error.to_string(), true),
            Err(_) => ("request timed out after 30 seconds".into(), true),
        };
        if !retry || attempt == 3 {
            return Err((error, attempt));
        }
        tokio::time::sleep(Duration::from_millis(250 * attempt as u64)).await;
    }
    unreachable!("three-attempt loop always returns")
}

fn discover_bundles(html: &str, base: &Url) -> Result<Vec<Url>, MaterialSyncError> {
    let tree = parse_html(html);
    let mut urls = BTreeMap::new();
    for id in tree.descendants(tree.document()) {
        let raw = tree
            .with_node(id, |node| {
                if node.as_element().is_none_or(|name| {
                    let local: &str = name.local.as_ref();
                    local != "script"
                }) {
                    return None;
                }
                node.attrs()?
                    .iter()
                    .find(|attr| attr.qualified_name_eq("src"))
                    .map(|attr| attr.value.clone())
            })
            .flatten();
        let Some(raw) = raw else { continue };
        let Ok(url) = base.join(&raw) else { continue };
        let filename = url.path().rsplit('/').next().unwrap_or_default();
        if same_origin(&url) && filename.starts_with("main.") && filename.ends_with(".js") {
            urls.insert(url.to_string(), url);
        }
    }
    if urls.is_empty() || urls.len() > MAX_BUNDLES {
        return Err(MaterialSyncError::Discovery("expected 1..=8 same-origin main bundles".into()));
    }
    Ok(urls.into_values().collect())
}

fn discover_catalog(bundle: &str) -> Result<(String, Vec<CatalogDocument>), MaterialSyncError> {
    if bundle.len() > MAX_BODY {
        return Err(MaterialSyncError::Discovery("bundle exceeds 16 MiB".into()));
    }
    let version_re = Regex::new(r#"(?:"carbonVersion"|carbonVersion)\s*:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2})""#).expect("constant version regex");
    let version = version_re
        .captures(bundle)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().to_owned())
        .ok_or_else(|| MaterialSyncError::Discovery("missing validated Carbon version".into()))?;
    let entry_re = Regex::new(
        r#"\{\s*"slug"\s*:\s*"([^"]{0,512})"\s*,\s*"exportedCarbonFileId"\s*:\s*"([^"]{0,128})""#,
    )
    .expect("constant catalog regex");
    let uuid_re =
        Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$")
            .expect("constant UUID regex");
    let mut files = BTreeMap::<String, Vec<String>>::new();
    let mut routes = BTreeMap::<String, String>::new();
    for capture in entry_re.captures_iter(bundle) {
        let slug = &capture[1];
        let file = &capture[2];
        if !valid_slug(slug) || !uuid_re.is_match(file) {
            return Err(MaterialSyncError::Discovery(
                "unsafe catalog slug or Carbon filename".into(),
            ));
        }
        if let Some(previous) = routes.insert(slug.to_owned(), file.to_owned())
            && previous != file
        {
            return Err(MaterialSyncError::Discovery(
                "conflicting files for a catalog route".into(),
            ));
        }
        let slugs = files.entry(file.to_owned()).or_default();
        if !slugs.iter().any(|value| value == slug) {
            slugs.push(slug.to_owned());
        }
        if files.len() > MAX_DOCS {
            return Err(MaterialSyncError::Discovery("catalog exceeds 2000 documents".into()));
        }
    }
    if files.is_empty() {
        return Err(MaterialSyncError::Discovery("no published Carbon files found".into()));
    }
    Ok((
        version,
        files.into_iter().map(|(file_id, slugs)| CatalogDocument { file_id, slugs }).collect(),
    ))
}

fn valid_slug(slug: &str) -> bool {
    slug.is_empty()
        || (slug.len() <= 512
            && !slug.starts_with('/')
            && !slug.ends_with('/')
            && slug.split('/').all(|part| {
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && part.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
                    })
            }))
}

async fn save_source(
    output: &Path,
    fetched: &Fetched,
) -> Result<MaterialSource, MaterialSyncError> {
    let path = local_relative_path(&fetched.url, fetched.url.path() == "/");
    safe_write(output, &path, &fetched.body).await.map_err(io_error)?;
    Ok(MaterialSource {
        url: fetched.url.to_string(),
        path: path.to_string_lossy().replace('\\', "/"),
        bytes: fetched.body.len() as u64,
        sha256: hash(&fetched.body),
    })
}

fn hash(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    Sha256::digest(bytes)
        .iter()
        .flat_map(|byte| {
            [char::from(HEX[usize::from(byte >> 4)]), char::from(HEX[usize::from(byte & 0x0F)])]
        })
        .collect()
}

async fn save_document(
    output: &Path,
    entry: &CatalogDocument,
    fetched: &Fetched,
) -> Result<(MaterialDocument, Vec<Url>, u64), String> {
    let json: Value = serde_json::from_slice(&fetched.body)
        .map_err(|error| format!("invalid Carbon JSON: {error}"))?;
    let sections = json
        .get("sections")
        .and_then(Value::as_array)
        .ok_or_else(|| "Carbon document lacks a sections array".to_owned())?;
    let slug = entry.slugs.first().cloned().unwrap_or_default();
    let page_url = seed_url(&slug);
    let (html, assets) = document_html(&json, &page_url);
    let markdown = html_to_markdown(&html, Some(page_url.as_str()));
    if markdown.trim().is_empty() {
        return Err("Carbon document has no extractable content".into());
    }
    let title = json
        .get("headerTitle")
        .or_else(|| json.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("Material Design")
        .to_owned();
    let raw_path = local_relative_path(&fetched.url, false);
    let mut markdown_path = Path::new("documents").join(local_relative_path(&page_url, true));
    markdown_path.set_extension("md");
    let markdown = format!(
        "<!-- Source: {} | Carbon: {} | SHA-256: {} -->\n\n{markdown}\n",
        fetched.url,
        fetched.url.path().split('/').nth(4).unwrap_or_default(),
        hash(&fetched.body)
    );
    safe_write(output, &raw_path, &fetched.body).await.map_err(|error| error.to_string())?;
    safe_write(output, &markdown_path, markdown.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    let bytes = (fetched.body.len() + markdown.len()) as u64;
    Ok((
        MaterialDocument {
            slug,
            slugs: entry.slugs.clone(),
            source_url: fetched.url.to_string(),
            raw_path: raw_path.to_string_lossy().replace('\\', "/"),
            markdown_path: markdown_path.to_string_lossy().replace('\\', "/"),
            sha256: hash(&fetched.body),
            markdown_sha256: hash(markdown.as_bytes()),
            title,
            sections: sections.len(),
        },
        assets,
        bytes,
    ))
}

fn escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn document_html(value: &Value, base: &Url) -> (String, Vec<Url>) {
    let mut html = String::from("<main>");
    let mut assets = BTreeMap::<String, Url>::new();
    collect_json_assets(value, base, &mut assets);
    let mut stack = vec![("", value)];
    while let Some((key, value)) = stack.pop() {
        match value {
            Value::Array(items) => stack.extend(items.iter().rev().map(|item| (key, item))),
            Value::Object(map) => {
                // Preserve Google document/section/block/chunk order independently
                // of serde_json's alphabetical object-key representation.
                for field in [
                    "contentChunks",
                    "contentBlocks",
                    "sections",
                    "snippetCode",
                    "footer",
                    "htmlValue",
                    "description",
                    "captionModifierCustomName",
                    "altText",
                    "title",
                    "headerTitle",
                    "name",
                ] {
                    if let Some(value) = map.get(field) {
                        stack.push((field, value));
                    }
                }
                for (field, value) in map {
                    if matches!(
                        field.as_str(),
                        "headerImageUrl" | "imageUrl" | "imageUrlFife" | "videoUrl" | "codeUrl"
                    ) && let Some(raw) = value.as_str()
                        && let Some(url) = public_asset(base, raw)
                    {
                        assets.insert(url.to_string(), url);
                    }
                }
            },
            Value::String(text) if !text.trim().is_empty() => match key {
                "htmlValue" | "footer" => {
                    html.push_str(text);
                    collect_html_assets(text, base, &mut assets);
                },
                "snippetCode" => {
                    html.push_str(&format!("<pre><code>{}</code></pre>", escape(text)))
                },
                "title" | "headerTitle" | "name" => {
                    html.push_str(&format!("<h2>{}</h2>", escape(text)))
                },
                "description" | "captionModifierCustomName" | "altText" => {
                    html.push_str(&format!("<p>{}</p>", escape(text)))
                },
                _ => {},
            },
            _ => {},
        }
    }
    html.push_str("</main>");
    (html, assets.into_values().collect())
}

fn collect_json_assets(value: &Value, base: &Url, assets: &mut BTreeMap<String, Url>) {
    let mut stack = vec![("", value)];
    while let Some((key, value)) = stack.pop() {
        match value {
            Value::Array(items) => stack.extend(items.iter().map(|item| (key, item))),
            Value::Object(map) => {
                stack.extend(map.iter().map(|(key, value)| (key.as_str(), value)))
            },
            Value::String(raw)
                if raw.starts_with("https://")
                    || raw.starts_with("http://")
                    || raw.starts_with('/') =>
            {
                let key = key.to_ascii_lowercase();
                let Some(url) = public_asset(base, raw) else { continue };
                let extension = Path::new(url.path())
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let media_field = ["image", "video", "font", "asset", "thumbnail", "poster"]
                    .iter()
                    .any(|part| key.contains(part))
                    || matches!(key.as_str(), "src" | "codeurl");
                let media_extension = matches!(
                    extension.as_str(),
                    "png"
                        | "jpg"
                        | "jpeg"
                        | "webp"
                        | "avif"
                        | "gif"
                        | "svg"
                        | "ico"
                        | "mp4"
                        | "webm"
                        | "mov"
                        | "mp3"
                        | "wav"
                        | "ogg"
                        | "woff"
                        | "woff2"
                        | "ttf"
                        | "otf"
                        | "glb"
                        | "gltf"
                        | "wasm"
                        | "pdf"
                        | "zip"
                        | "json"
                        | "css"
                        | "js"
                );
                if media_field || media_extension {
                    assets.insert(url.to_string(), url);
                }
            },
            _ => {},
        }
    }
}

fn public_asset(base: &Url, raw: &str) -> Option<Url> {
    let mut url = base.join(raw.trim()).ok()?;
    let public_host = match url.host()? {
        url::Host::Domain(host) => {
            host.contains('.')
                && !host.ends_with(".localhost")
                && !host.ends_with(".local")
                && !host.ends_with(".internal")
        },
        url::Host::Ipv4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
        },
        url::Host::Ipv6(ip) => {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
                && !ip.is_multicast()
        },
    };
    if raw.trim().is_empty()
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !public_host
    {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

fn collect_html_assets(html: &str, base: &Url, assets: &mut BTreeMap<String, Url>) {
    let tree = parse_html(html);
    for id in tree.descendants(tree.document()) {
        let raw = tree
            .with_node(id, |node| {
                node.attrs().map(|attrs| {
                    attrs
                        .iter()
                        .filter(|attr| {
                            attr.qualified_name_eq("src") || attr.qualified_name_eq("poster")
                        })
                        .map(|attr| attr.value.clone())
                        .collect::<Vec<_>>()
                })
            })
            .flatten()
            .unwrap_or_default();
        for raw in raw {
            if let Some(url) = public_asset(base, &raw) {
                assets.insert(url.to_string(), url);
            }
        }
    }
}

async fn write_indexes(
    output: &Path,
    report: &MaterialSyncReport,
) -> Result<(), MaterialSyncError> {
    let catalog = serde_json::json!({ "schema_version": 1, "source_url": report.source_url,
        "carbon_version": report.carbon_version, "catalog_routes": report.catalog_routes,
        "catalog_documents": report.catalog_documents, "documents_written": report.documents_written,
        "truncated": report.truncated, "failures": report.failures, "sources": report.sources,
        "catalog": report.catalog, "documents": report.entries });
    let assets = report.assets.iter().map(|url| serde_json::json!({ "url": url,
        "host": url.host_str(), "extension": Path::new(url.path()).extension().and_then(|ext| ext.to_str()) })).collect::<Vec<_>>();
    let assets = serde_json::json!({ "schema_version": 1, "source_url": SOURCE, "carbon_version": report.carbon_version,
        "count": assets.len(), "truncated": report.assets_truncated, "assets": assets });
    let mut index = format!(
        "# Material Design — acquired source documents\n\nSource: {}\n\nCarbon version: `{}`\n\nAcquired: {} / {} published documents; {} routes. Truncated: {}. Failures: {}.\n\nThese are Google source content and extracted Markdown; no Aphrody implementation parity is implied.\n\n[Catalog]({}) · [Asset URLs]({}) · [Receipt]({})\n\n",
        report.source_url,
        report.carbon_version,
        report.documents_written,
        report.catalog_documents,
        report.catalog_routes,
        report.truncated,
        report.failures.len(),
        report.catalog_path,
        report.assets_path,
        report.receipt_path
    );
    for entry in &report.entries {
        index.push_str(&format!("- `{}` — [Markdown]({}), [structured source]({}), [Google]({}); {} sections; SHA-256 `{}`\n", entry.slug, entry.markdown_path, entry.raw_path, entry.source_url, entry.sections, entry.sha256));
    }
    if report.truncated || !report.failures.is_empty() {
        index.push_str("\n## Published catalog coverage\n\n");
        for entry in &report.catalog {
            let acquired =
                report.entries.iter().any(|document| document.source_url == entry.source_url);
            index.push_str(&format!(
                "- [{}]({}) — acquired: {}\n",
                entry.slugs.join(", "),
                entry.source_url,
                acquired
            ));
        }
    }
    for failure in &report.failures {
        index.push_str(&format!("\nFailed: {} — {}\n", failure.url, failure.error));
    }
    for (path, bytes) in [
        (&report.catalog_path, serde_json::to_vec_pretty(&catalog).map_err(io_error)?),
        (&report.assets_path, serde_json::to_vec_pretty(&assets).map_err(io_error)?),
        (&report.receipt_path, serde_json::to_vec_pretty(report).map_err(io_error)?),
        (&report.ai_index_path, index.into_bytes()),
    ] {
        safe_write(output, Path::new(path), &bytes).await.map_err(io_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprints_use_standard_lowercase_sha256() {
        assert_eq!(hash(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(
            hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn catalog_discovers_real_carbon_shape_and_preserves_tab_aliases() {
        let bundle = r#"carbonVersion:"2026-09-23_06-10-05";JSON.parse('{"v":[{"slug":"styles/color/overview","exportedCarbonFileId":"a513b32c-174e-4b85-8553-60701c021797.json"},{"slug":"styles/color/tokens","exportedCarbonFileId":"a513b32c-174e-4b85-8553-60701c021797.json"},{"slug":"search.html","exportedCarbonFileId":null}]}')"#;
        let (version, entries) = discover_catalog(bundle).unwrap();
        assert_eq!(version, "2026-09-23_06-10-05");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].slugs.len(), 2);
    }

    #[test]
    fn catalog_rejects_traversal_and_changed_schema() {
        for slug in
            ["../secret", "x/../secret", "%2e%2e/secret", "x\\secret", "/absolute", "x?secret"]
        {
            assert!(!valid_slug(slug));
        }
        let bundle = r#"carbonVersion:"2026-09-23_06-10-05";{"slug":"../secret","exportedCarbonFileId":"a513b32c-174e-4b85-8553-60701c021797.json"}"#;
        assert!(discover_catalog(bundle).is_err());
        assert!(discover_catalog("no published version or files").is_err());
    }

    #[test]
    fn discovery_uses_only_same_origin_main_scripts() {
        let html = r#"<script src="/static/angular/main.7906.js"></script><script src="https://evil.example/main.fake.js"></script><script src="/static/runtime.js"></script>"#;
        let scripts = discover_bundles(html, &seed_url("/")).unwrap();
        assert_eq!(scripts.len(), 1);
        assert_eq!(scripts[0].path(), "/static/angular/main.7906.js");
        assert!(!same_origin(&Url::parse("https://user:mypass@m3.material.io/").unwrap()));
    }

    #[test]
    fn actual_carbon_fields_keep_all_tabs_html_footer_and_code() {
        let value = serde_json::json!({"title":"Material Design", "sections":[
            {"name":"Overview", "contentBlocks":[{"contentChunks":[{"htmlValue":"<h2>Material at Google I/O 2026</h2><p>35 shapes &amp; expressive motion.</p>","footer":"<p>Compose-first</p>","imageUrl":"https://lh3.googleusercontent.com/public-image=s960"}]}]},
            {"name":"Specs", "contentBlocks":[{"contentChunks":[{"htmlValue":"<table><tr><th>Role</th><th>Value</th></tr><tr><td>Target</td><td>48 dp</td></tr></table>","snippetCode":"button <primary>","videoUrl":"https://storage.googleapis.com/material-io-design/m3/assets/motion.mp4"}]}]}
        ]});
        let (html, assets) = document_html(&value, &seed_url("styles/motion/overview"));
        let md = html_to_markdown(&html, Some(SOURCE));
        for text in ["I/O 2026", "35 shapes", "Compose-first", "Specs", "48 dp", "button <primary>"]
        {
            assert!(md.contains(text), "missing {text}: {md}");
        }
        assert_eq!(assets.len(), 2);
        // External public CDN media is retained; Obscura applies its network
        // policy when the existing mirror actually fetches it.
        assert!(public_asset(&seed_url("/"), "https://cdn.example/image.png").is_some());
        for url in [
            "https://localhost/private.png",
            "https://127.0.0.1/private.png",
            "https://10.0.0.1/private.png",
            "https://[::1]/private.png",
            "https://user:password@cdn.example/private.png",
            "file:///private.png",
        ] {
            assert!(public_asset(&seed_url("/"), url).is_none(), "accepted {url}");
        }
    }

    #[test]
    fn acquisition_rejects_zero_and_excessive_budgets() {
        let output = Path::new("mirror");
        for (docs, concurrency) in [(0, 1), (MAX_DOCS + 1, 1), (1, 0), (1, MAX_CONCURRENCY + 1)] {
            assert!(validate_bounds(output, docs, concurrency).is_err());
        }
        assert!(validate_bounds(Path::new(""), 1, 1).is_err());
        assert!(validate_bounds(output, MAX_DOCS, MAX_CONCURRENCY).is_ok());
    }

    #[test]
    fn embedded_module_assets_are_collected_without_treating_page_links_as_assets() {
        let value = serde_json::json!({"moduleConfigurationOverrides": {"carousel": [
            {"image": "https://cdn.example/frame-without-extension", "linkUrl": "https://m3.material.io/styles/color/overview"},
            {"downloadUrl": "https://cdn.example/material-kit.zip"}
        ]}});
        let (_, assets) = document_html(&value, &seed_url("/"));
        assert_eq!(assets.len(), 2);
        assert!(assets.iter().any(|url| url.path().ends_with(".zip")));
        assert!(!assets.iter().any(|url| url.path().contains("styles/color")));
    }
}
