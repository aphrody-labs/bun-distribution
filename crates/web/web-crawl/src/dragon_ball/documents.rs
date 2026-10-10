// SPDX-License-Identifier: Apache-2.0
// Projection contract from integrated BXC apps/bxc/src/archive/dragonball-export.ts.
use super::structured::{attribute, parse_translation};
use super::{DialogueNode, sha256, validate_source_url};
use aphrody_web_extract::{extract_main, media::extract_media_candidates};
use obscura_dom::parse_html;
use regex::Regex;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EmbeddedMedia {
    pub url: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub caption: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StructuredFields {
    pub series_identifier: Option<String>,
    pub episode_or_chapter_number: Option<u32>,
    pub toc_rank: Option<u32>,
    pub original_print_source: Option<String>,
    pub dialogue_nodes: Vec<DialogueNode>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Payload {
    pub title_raw: String,
    pub publication_date: Option<String>,
    pub authors_or_entities: Vec<String>,
    pub structured_fields: StructuredFields,
    pub body_markdown: String,
    pub embedded_media: Vec<EmbeddedMedia>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DragonBallDocument {
    pub crawl_id: String,
    pub document_uid: String,
    pub canonical_url: String,
    pub source_domain: String,
    pub category: String,
    pub http_status: u16,
    pub payload: Payload,
    pub raw_checksum: String,
    pub timestamp_utc: String,
    #[serde(default)]
    pub provenance: Value,
    #[serde(default)]
    pub canonical_eligible: bool,
}

pub(crate) fn category(url: &Url) -> &'static str {
    let host = url.host_str().unwrap_or_default();
    match host {
        "lineup.toei-anim.co.jp" => "toei_episode",
        "www.kanzenshuu.com" => "kanzenshuu_translation",
        "www.jajanken.net" => "jump_metrics",
        "archive.org" | "web.archive.org" => "multimedia_archive",
        _ if host == "dragon-ball-official.com" || host.ends_with(".dragon-ball-official.com") => {
            "official_news"
        },
        _ if host == "dragonballfr.com" || host.ends_with(".dragonballfr.com") => {
            "shenron_community"
        },
        "comic.dragonballcn.com" => "bibliography",
        _ => "biography",
    }
}

fn media_kind(url: &Url) -> Option<&'static str> {
    let path = url.path().to_ascii_lowercase();
    if ["avif", "gif", "jpg", "jpeg", "png", "svg", "webp"]
        .iter()
        .any(|ext| path.ends_with(&format!(".{ext}")))
    {
        Some("image")
    } else if ["m3u8", "mp4", "mov", "webm", "mpd", "m4v"]
        .iter()
        .any(|ext| path.ends_with(&format!(".{ext}")))
    {
        Some("video")
    } else if ["aac", "flac", "m4a", "mp3", "ogg", "wav"]
        .iter()
        .any(|ext| path.ends_with(&format!(".{ext}")))
    {
        Some("audio")
    } else {
        None
    }
}

fn embedded_media(html: &str, markdown: &str, base: &Url) -> Vec<EmbeddedMedia> {
    let dom = parse_html(html);
    let mut seen = HashSet::new();
    let mut media = Vec::new();
    let mut add = |raw: &str, explicit: Option<&str>, caption: Option<String>| {
        let raw = raw.trim_end_matches([')', ',', '.', ';']);
        let Ok(url) = base.join(raw) else { return };
        if validate_source_url(url.as_str()).is_err() {
            return;
        }
        let Some(kind) = media_kind(&url).or(explicit) else { return };
        if seen.insert(url.to_string()) {
            media.push(EmbeddedMedia { url: url.to_string(), kind: kind.into(), caption });
        }
    };
    for id in dom.query_selector_all("img, video, audio, source").unwrap_or_default() {
        let Some((name, src, caption, poster)) = dom.with_node(id, |node| {
            let name = node.as_element().map(|name| name.local.to_string()).unwrap_or_default();
            let src = ["src", "data-src", "data-original"]
                .into_iter()
                .find_map(|key| node.get_attribute(key))
                .map(str::to_owned);
            let caption = node
                .get_attribute("alt")
                .or_else(|| node.get_attribute("title"))
                .map(str::to_owned);
            (name, src, caption, node.get_attribute("poster").map(str::to_owned))
        }) else {
            continue;
        };
        if let Some(src) = src {
            add(
                &src,
                Some(match name.as_str() {
                    "img" => "image",
                    "audio" => "audio",
                    _ => "video",
                }),
                caption,
            );
        }
        if let Some(poster) = poster {
            add(&poster, Some("image"), None);
        }
        if let Some(srcset) =
            dom.with_node(id, |node| node.get_attribute("srcset").map(str::to_owned)).flatten()
        {
            for candidate in srcset.split(',') {
                if let Some(src) = candidate.split_whitespace().next() {
                    add(src, Some("image"), None);
                }
            }
        }
    }
    for selector in [
        "meta[property='og:image']",
        "meta[name='twitter:image']",
        "meta[name='twitter:image:src']",
    ] {
        if let Some(src) = attribute(&dom, selector, "content") {
            add(&src, Some("image"), None);
        }
    }
    for id in dom
        .query_selector_all("link[rel='image_src'], link[rel='preload'][as='image']")
        .unwrap_or_default()
    {
        if let Some(src) =
            dom.with_node(id, |node| node.get_attribute("href").map(str::to_owned)).flatten()
        {
            add(&src, Some("image"), None);
        }
    }
    let bare = Regex::new(r#"https?://[^\s\"'<>\\]+"#).expect("static media URL regex");
    for value in bare.find_iter(markdown).chain(bare.find_iter(html)) {
        add(value.as_str(), None, None);
    }
    for candidate in extract_media_candidates(html, base.as_str()) {
        add(&candidate.url, Some("video"), candidate.label);
    }
    media
}

fn string(metadata: &Value, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Project one acquired page into the historical Shenron JSONL contract.
/// The metadata object is retained as provenance, without editorial promotion.
pub fn project_document(
    url: &Url,
    status: u16,
    html: &str,
    markdown: &str,
    metadata: &Value,
    timestamp: &str,
) -> Result<DragonBallDocument, String> {
    validate_source_url(url.as_str())?;
    let canonical = string(metadata, "canonical")
        .map(|value| validate_source_url(&value))
        .transpose()?
        .unwrap_or_else(|| url.clone());
    let extracted = extract_main(html, Some(url.as_str()));
    let translation = if canonical.host_str() == Some("www.kanzenshuu.com")
        && canonical.path().contains("/translations/")
    {
        parse_translation(html)
    } else {
        Default::default()
    };
    let title = string(metadata, "title").or(translation.title).unwrap_or(extracted.title);
    let mut people = Vec::new();
    if let Some(author) =
        string(metadata, "author").or_else(|| string(metadata, "authorName")).or(extracted.byline)
    {
        people.push(author);
    }
    for person in translation.people {
        if !people.contains(&person) {
            people.push(person);
        }
    }
    let route = Regex::new(r"^/ja/tv/([^/]+)/episode/(\d+)/?$").expect("static Toei fields");
    let toei = route.captures(canonical.path());
    let markdown = if markdown.is_empty() { extracted.markdown } else { markdown.into() };
    let fields = StructuredFields {
        series_identifier: string(metadata, "series")
            .or_else(|| toei.as_ref().map(|value| value[1].into())),
        episode_or_chapter_number: metadata
            .get("episodeNumber")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .or_else(|| toei.as_ref().and_then(|value| value[2].parse().ok())),
        toc_rank: metadata
            .get("tocRank")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
        original_print_source: string(metadata, "originalPrintSource")
            .or(translation.original_print_source),
        dialogue_nodes: translation.dialogue,
    };
    let timestamp_utc = chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|date| date.with_timezone(&chrono::Utc).to_rfc3339())
        .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
    let payload = Payload {
        title_raw: title,
        publication_date: string(metadata, "publicationDate")
            .or_else(|| string(metadata, "date"))
            .or(translation.publication_date)
            .or(extracted.published),
        authors_or_entities: people,
        structured_fields: fields,
        embedded_media: embedded_media(html, &markdown, &canonical),
        body_markdown: markdown.clone(),
    };
    Ok(DragonBallDocument {
        crawl_id: "crawl_toriyama_archive_full".into(),
        document_uid: sha256(&format!("{}{}", canonical.host_str().unwrap_or_default(), canonical)),
        canonical_url: canonical.to_string(),
        source_domain: canonical.host_str().unwrap_or_default().into(),
        category: category(&canonical).into(),
        http_status: status,
        payload,
        raw_checksum: sha256(&markdown),
        timestamp_utc,
        provenance: metadata.clone(),
        canonical_eligible: false,
    })
}

pub(crate) fn write_private(path: &Path, content: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = path.with_extension(format!("{}.{}.tmp", std::process::id(), nonce));
    let result = (|| {
        let mut file = options.open(&temp).map_err(|error| error.to_string())?;
        file.write_all(content).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        std::fs::rename(&temp, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Read-only import of BXC databases. Latest row wins per canonical URL;
/// original metadata, structured JSON and crawl source remain in provenance.
pub fn export_bxc(databases: &[PathBuf], output: &Path) -> Result<usize, String> {
    let mut documents = BTreeMap::new();
    let mut rejected = Vec::new();
    for path in databases {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| error.to_string())?;
        let columns = connection
            .prepare("PRAGMA table_info(scrapes)")
            .map_err(|error| error.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        let structured =
            if columns.iter().any(|name| name == "json_data") { "s.json_data" } else { "NULL" };
        let mut query=connection.prepare(&format!("SELECT s.id,s.url,s.status,s.content,s.metadata,{structured},s.markdown,s.timestamp FROM scrapes s JOIN (SELECT url,MAX(id) id FROM scrapes GROUP BY url) latest ON latest.id=s.id ORDER BY s.id")).map_err(|error|error.to_string())?;
        let mut rows = query.query([]).map_err(|error| error.to_string())?;
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            let url: String = row.get(1).map_err(|error| error.to_string())?;
            let parsed = match validate_source_url(&url) {
                Ok(url) => url,
                Err(reason) => {
                    rejected.push(serde_json::json!({"sourceDatabase":path,"sourceUrlSha256":sha256(&url),"reason":reason}));
                    continue;
                },
            };
            let content: Option<String> = row.get(3).map_err(|error| error.to_string())?;
            let metadata: Option<String> = row.get(4).map_err(|error| error.to_string())?;
            let structured: Option<String> = row.get(5).map_err(|error| error.to_string())?;
            let mut combined = structured
                .and_then(|value| serde_json::from_str::<Value>(&value).ok())
                .and_then(|value| value.as_object().cloned())
                .unwrap_or_default();
            if let Some(value) = metadata
                .and_then(|value| serde_json::from_str::<Value>(&value).ok())
                .and_then(|value| value.as_object().cloned())
            {
                for (key, value) in value {
                    if !value.is_null() {
                        combined.insert(key, value);
                    }
                }
            }
            combined.insert("crawlSource".into(), Value::String(path.display().to_string()));
            let markdown: Option<String> = row.get(6).map_err(|error| error.to_string())?;
            let timestamp: Option<String> = row.get(7).map_err(|error| error.to_string())?;
            let status: Option<u16> = row.get(2).map_err(|error| error.to_string())?;
            let document = match project_document(
                &parsed,
                status.unwrap_or(0),
                content.as_deref().unwrap_or_default(),
                markdown.as_deref().unwrap_or_default(),
                &Value::Object(combined),
                timestamp.as_deref().unwrap_or_default(),
            ) {
                Ok(document) => document,
                Err(reason) => {
                    rejected.push(serde_json::json!({"sourceDatabase":path,"sourceUrlSha256":sha256(&url),"reason":reason}));
                    continue;
                },
            };
            let key = document.canonical_url.clone();
            if documents.get(&key).is_none_or(|existing: &DragonBallDocument| {
                existing.timestamp_utc <= document.timestamp_utc
            }) {
                documents.insert(key, document);
            }
        }
    }
    let count = documents.len();
    let mut data = String::new();
    for document in documents.into_values() {
        data.push_str(&serde_json::to_string(&document).map_err(|error| error.to_string())?);
        data.push('\n');
    }
    write_private(output, data.as_bytes())?;
    write_private(
        &output.with_extension("rejected.json"),
        &serde_json::to_vec_pretty(&rejected).map_err(|error| error.to_string())?,
    )?;
    Ok(count)
}

/// Materialize existing JSONL projections for the native RAG owner, offline.
pub fn materialize_documents(output: &Path) -> Result<usize, String> {
    let mut files = Vec::new();
    let corpus = output.join("corpus");
    if output.is_dir() {
        for entry in std::fs::read_dir(output).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().is_some_and(|ext| ext == "jsonl") {
                files.push(path);
            }
        }
    }
    if corpus.is_dir() {
        for entry in std::fs::read_dir(&corpus).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().is_some_and(|ext| ext == "jsonl") {
                files.push(path);
            }
        }
    }
    let projection = output.join("shenron-documents.jsonl");
    if projection.is_file() {
        files.push(projection);
    }
    files.sort();
    files.dedup();
    let mut documents = BTreeMap::new();
    for file in files {
        let text = std::fs::read_to_string(file).map_err(|error| error.to_string())?;
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
            let url = value
                .get("url")
                .or_else(|| value.get("canonical_url"))
                .and_then(Value::as_str)
                .ok_or("corpus record has no URL")?;
            validate_source_url(url)?;
            let markdown = value
                .get("markdown")
                .or_else(|| value.get("payload").and_then(|payload| payload.get("body_markdown")))
                .and_then(Value::as_str)
                .ok_or("corpus record has no markdown")?;
            if markdown.trim().is_empty() {
                continue;
            }
            let title = value
                .get("name")
                .or_else(|| value.get("payload").and_then(|payload| payload.get("title_raw")))
                .and_then(Value::as_str)
                .unwrap_or(url);
            documents.insert(url.to_owned(), format!("# {title}\n\nSource: {url}\n\n{markdown}\n"));
        }
    }
    for (url, markdown) in &documents {
        write_private(
            &output.join("documents").join(format!("{}.md", sha256(url))),
            markdown.as_bytes(),
        )?;
    }
    Ok(documents.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_export_contract_keeps_media_fields_sha256_and_no_promotion() {
        let url = Url::parse("https://lineup.toei-anim.co.jp/ja/tv/dragonz/episode/12/").unwrap();
        let document=project_document(&url,200,"<img data-src='/thumb?id=12' alt='Goku'><video src='https://cdn.example.test/preview.mp4'></video>","https://cdn.example.test/episode.webp",&serde_json::json!({"title":"第12話","series":"dragonz","episodeNumber":12}),"2026-09-15T12:00:00Z").unwrap();
        assert_eq!(document.category, "toei_episode");
        assert_eq!(document.payload.structured_fields.episode_or_chapter_number, Some(12));
        assert_eq!(document.payload.embedded_media.len(), 3);
        assert_eq!(document.document_uid.len(), 64);
        assert_eq!(document.raw_checksum, sha256("https://cdn.example.test/episode.webp"));
        assert!(!document.canonical_eligible);
    }
    #[test]
    fn bxc_import_is_readonly_and_prefers_latest_row_for_canonical() {
        let dir =
            std::env::temp_dir().join(format!("aphrody-dragon-ball-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("source.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE scrapes(id INTEGER PRIMARY KEY,url TEXT,status INTEGER,content TEXT,metadata TEXT,markdown TEXT,timestamp TEXT);INSERT INTO scrapes VALUES(1,'https://www.kanzenshuu.com/translations/test/',200,'<h1>Old</h1>','{}','old','2026-01-01T00:00:00Z'),(2,'https://www.kanzenshuu.com/translations/test/',200,'<h1>New</h1>','{}','new','2026-01-02T00:00:00Z');").unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert_eq!(
            export_bxc(std::slice::from_ref(&path), &dir.join("shenron-documents.jsonl")).unwrap(),
            1
        );
        assert_eq!(before, std::fs::read(&path).unwrap());
        assert_eq!(materialize_documents(&dir).unwrap(), 1);
        let output = std::fs::read_to_string(dir.join("shenron-documents.jsonl")).unwrap();
        assert!(output.contains("new"));
        assert!(!output.contains("\"body_markdown\":\"old\""));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
