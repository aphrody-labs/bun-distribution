// SPDX-License-Identifier: Apache-2.0
//! Structured MediaWiki page dossier, backed by the shared MediaWiki transport.

use std::collections::BTreeMap;
use std::time::Instant;

use aphrody_web_extract::{extract_main, html_to_markdown};
use obscura_dom::{DomTree, NodeData, NodeId, parse_html};
use obscura_net::ObscuraHttpClient;
use serde::Serialize;
use serde_json::Value;
use url::Url;

use crate::mediawiki::{
    MediaWikiError, MediaWikiOptions, api_error, request_json, validate_options,
};

/// Optional, potentially large parts of a dossier. Images are resolved to original files by
/// default; Markdown and wikitext are omitted unless `include_content` is enabled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WikiPageOptions {
    pub include_images: bool,
    pub include_content: bool,
}

impl Default for WikiPageOptions {
    fn default() -> Self {
        Self { include_images: true, include_content: false }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WikiPageSection {
    pub niveau: u32,
    pub titre: String,
    pub ancre: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WikiInfoboxValue {
    pub brut: String,
    pub propre: String,
}

pub type WikiInfobox = BTreeMap<String, WikiInfoboxValue>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WikiTable {
    pub index: usize,
    pub titre: Option<String>,
    pub entetes: Vec<String>,
    pub lignes: Vec<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WikiImage {
    pub fichier: String,
    pub url: String,
    pub largeur: Option<u64>,
    pub hauteur: Option<u64>,
    pub mime: Option<String>,
    pub sha1: Option<String>,
}

/// Wiki page dossier (shape of the `WikiPageDossierSchema` consumer contract); absent content
/// stays absent in serialized output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WikiPageDossier {
    pub url: String,
    pub titre: String,
    pub api: String,
    pub revid: Option<u64>,
    pub sections: Vec<WikiPageSection>,
    pub infobox: Vec<WikiInfobox>,
    pub tableaux: Vec<WikiTable>,
    pub images: Vec<WikiImage>,
    pub categories: Vec<String>,
    pub liens_externes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wikitext: Option<String>,
    pub mesures: BTreeMap<String, u64>,
}

struct PageContent {
    titre: String,
    html: Option<String>,
    markdown: Option<String>,
    wikitext: Option<String>,
    sections: Vec<WikiPageSection>,
    image_titles: Vec<String>,
    categories: Vec<String>,
    external_links: Vec<String>,
    revid: Option<u64>,
    api: &'static str,
}

/// Fetch a page's Action API parse result and return its structured dossier.
///
/// Only HTTP(S) article URLs on the configured wiki host are accepted. All requests (including
/// 50-image batches) flow through `mediawiki::request_json` and share its request pacing state.
pub async fn page_dossier(
    client: &ObscuraHttpClient,
    api_options: &MediaWikiOptions,
    page_url: &str,
    options: WikiPageOptions,
) -> Result<WikiPageDossier, MediaWikiError> {
    validate_options(api_options)?;
    let (page_url, title) = page_target(page_url, api_options)?;
    let mut last_request: Option<Instant> = None;
    let action_page = fetch_action_page(client, api_options, &title, &mut last_request).await;
    let content = match action_page {
        Ok(content) => content,
        Err(error) if is_not_found(&error) => return Err(error),
        Err(action_error) => fetch_rest_page(client, api_options, &title, &mut last_request)
            .await
            .map_err(|rest_error| {
                MediaWikiError::InvalidResponse(format!(
                    "Action API failed ({action_error}); REST fallback failed ({rest_error})"
                ))
            })?,
    };
    let html = content.html.as_deref().unwrap_or_default();
    let markdown = content.markdown.clone().unwrap_or_else(|| {
        let extracted = extract_main(html, Some(page_url.as_str()));
        if extracted.markdown.trim().is_empty() {
            html_to_markdown(html, Some(page_url.as_str()))
        } else {
            extracted.markdown
        }
    });
    let images = if options.include_images {
        resolve_images(client, api_options, &content.image_titles, &mut last_request).await?
    } else {
        Vec::new()
    };
    let tables = parse_tables(html, Some(page_url.as_str()));
    let infobox = content.wikitext.as_deref().map(parse_infobox).unwrap_or_default();

    let mut measures = BTreeMap::new();
    measures.insert("sections".into(), content.sections.len() as u64);
    measures.insert("tableaux".into(), tables.len() as u64);
    measures.insert(
        "lignes_de_tableau".into(),
        tables.iter().map(|table| table.lignes.len() as u64).sum(),
    );
    measures.insert("images".into(), images.len() as u64);
    measures.insert("categories".into(), content.categories.len() as u64);
    measures.insert("octets_html".into(), html.len() as u64);
    measures.insert("octets_markdown".into(), markdown.len() as u64);
    measures.insert(
        "octets_wikitext".into(),
        content.wikitext.as_ref().map_or(0, |text| text.len() as u64),
    );

    Ok(WikiPageDossier {
        url: page_url.to_string(),
        titre: content.titre,
        api: content.api.into(),
        revid: content.revid,
        sections: content.sections,
        infobox,
        tableaux: tables,
        images,
        categories: content.categories,
        liens_externes: content.external_links,
        markdown: options.include_content.then_some(markdown),
        wikitext: options.include_content.then_some(content.wikitext).flatten(),
        mesures: measures,
    })
}

/// Fetch only Markdown, skipping the image-information batches used by a full dossier.
pub async fn page_markdown(
    client: &ObscuraHttpClient,
    api_options: &MediaWikiOptions,
    page_url: &str,
) -> Result<String, MediaWikiError> {
    page_dossier(
        client,
        api_options,
        page_url,
        WikiPageOptions { include_images: false, include_content: true },
    )
    .await?
    .markdown
    .ok_or_else(|| MediaWikiError::InvalidResponse("Markdown content is missing".into()))
}

async fn fetch_action_page(
    client: &ObscuraHttpClient,
    options: &MediaWikiOptions,
    title: &str,
    last_request: &mut Option<Instant>,
) -> Result<PageContent, MediaWikiError> {
    let props = "text|wikitext|sections|images|categories|externallinks|displaytitle|revid";
    let params = [
        ("action", "parse".to_owned()),
        ("format", "json".to_owned()),
        ("formatversion", "2".to_owned()),
        ("page", title.to_owned()),
        ("prop", props.to_owned()),
        ("redirects", "1".to_owned()),
    ];
    let response = request_json(client, options, &params, last_request).await?;
    if let Some(message) = api_error(&response) {
        return Err(MediaWikiError::Api(message));
    }
    let parsed = response
        .get("parse")
        .ok_or_else(|| MediaWikiError::InvalidResponse("page parse result is missing".into()))?;
    let html = parsed.get("text").and_then(Value::as_str).ok_or_else(|| {
        MediaWikiError::InvalidResponse("parse.text is missing or not a string".into())
    })?;
    if html.trim().len() < 200 {
        return Err(MediaWikiError::InvalidResponse(
            "Action API returned no rendered page content".into(),
        ));
    }
    let raw_title = parsed
        .get("displaytitle")
        .and_then(Value::as_str)
        .or_else(|| parsed.get("title").and_then(Value::as_str))
        .filter(|title| !title.trim().is_empty())
        .ok_or_else(|| MediaWikiError::InvalidResponse("parse.title is missing".into()))?;
    Ok(PageContent {
        titre: html_text(raw_title),
        html: Some(html.to_owned()),
        markdown: None,
        wikitext: parsed.get("wikitext").and_then(Value::as_str).map(str::to_owned),
        sections: parse_sections(parsed.get("sections"))?,
        image_titles: parse_images(parsed.get("images"))?,
        categories: parse_categories(parsed.get("categories"))?,
        external_links: parse_string_array(parsed.get("externallinks"), "parse.externallinks")?,
        revid: parsed.get("revid").and_then(Value::as_u64),
        api: "api.php",
    })
}

async fn fetch_rest_page(
    client: &ObscuraHttpClient,
    options: &MediaWikiOptions,
    title: &str,
    last_request: &mut Option<Instant>,
) -> Result<PageContent, MediaWikiError> {
    let mut rest_options = options.clone();
    rest_options.api_url = rest_page_url(&options.api_url, title)?;
    let response = request_json(client, &rest_options, &[], last_request).await?;
    if let Some(message) = api_error(&response) {
        return Err(MediaWikiError::Api(message));
    }
    let source = response
        .get("source")
        .and_then(Value::as_str)
        .filter(|source| source.trim().len() >= 200)
        .ok_or_else(|| {
            MediaWikiError::InvalidResponse("REST page source is missing or too short".into())
        })?;
    Ok(PageContent {
        titre: response.get("title").and_then(Value::as_str).unwrap_or(title).to_owned(),
        html: None,
        // The REST API returns wikitext source. This preserves the legacy Markdown consumer's
        // fallback behavior instead of pretending the source is rendered HTML.
        markdown: Some(source.to_owned()),
        wikitext: Some(source.to_owned()),
        sections: Vec::new(),
        image_titles: Vec::new(),
        categories: Vec::new(),
        external_links: Vec::new(),
        revid: response.pointer("/latest/id").and_then(Value::as_u64),
        api: "rest.php",
    })
}

fn rest_page_url(api_url: &Url, title: &str) -> Result<Url, MediaWikiError> {
    let mut url = api_url.clone();
    url.set_query(None);
    url.set_fragment(None);
    let base = url
        .path()
        .strip_suffix("api.php")
        .unwrap_or_else(|| url.path().rsplit_once('/').map_or("", |(parent, _)| parent));
    let encoded = url::form_urlencoded::byte_serialize(title.as_bytes())
        .collect::<String>()
        .replace('+', "%20");
    url.set_path(&format!("{}/rest.php/v1/page/{encoded}", base.trim_end_matches('/')));
    Ok(url)
}

fn is_not_found(error: &MediaWikiError) -> bool {
    matches!(error, MediaWikiError::Api(message) if message.starts_with("missingtitle:") || message.starts_with("invalidtitle:"))
}

fn page_target(raw: &str, options: &MediaWikiOptions) -> Result<(Url, String), MediaWikiError> {
    let url = Url::parse(raw)
        .map_err(|error| MediaWikiError::InvalidResponse(format!("invalid page URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str() != options.api_url.host_str()
        || url.port_or_known_default() != options.api_url.port_or_known_default()
    {
        return Err(MediaWikiError::InvalidResponse(
            "page URL must be credential-free HTTP(S) on the configured wiki host".into(),
        ));
    }
    let path_prefix = options.article_path.split("$1").next().unwrap_or("/wiki/");
    let path_title = url.path().strip_prefix(path_prefix).or_else(|| {
        let marker = "/wiki/";
        let index = url.path().rfind(marker)?;
        url.path().get(index + marker.len()..)
    });
    let title = url
        .query_pairs()
        .find_map(|(key, value)| (key == "title").then(|| value.into_owned()))
        .or_else(|| path_title.map(decode_path_component))
        .filter(|title| !title.trim().is_empty())
        .ok_or_else(|| {
            MediaWikiError::InvalidResponse(
                "page URL must use /wiki/<title> or a ?title=<title> query".into(),
            )
        })?;
    Ok((url, title.replace('_', " ").trim().to_owned()))
}

fn decode_path_component(value: &str) -> String {
    let query = format!("value={}", value.replace('+', "%2B"));
    url::form_urlencoded::parse(query.as_bytes())
        .find_map(|(key, value)| (key == "value").then(|| value.into_owned()))
        .unwrap_or_else(|| value.to_owned())
}

fn parse_sections(value: Option<&Value>) -> Result<Vec<WikiPageSection>, MediaWikiError> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let rows = value
        .as_array()
        .ok_or_else(|| MediaWikiError::InvalidResponse("parse.sections must be an array".into()))?;
    rows.iter()
        .map(|row| {
            let title = row.get("line").and_then(Value::as_str).ok_or_else(|| {
                MediaWikiError::InvalidResponse("MediaWiki section is missing line".into())
            })?;
            Ok(WikiPageSection {
                niveau: row
                    .get("level")
                    .and_then(|level| level.as_u64().or_else(|| level.as_str()?.parse().ok()))
                    .unwrap_or(1)
                    .min(u32::MAX as u64) as u32,
                titre: html_text(title),
                ancre: row.get("anchor").and_then(Value::as_str).unwrap_or_default().to_owned(),
            })
        })
        .collect()
}

fn parse_images(value: Option<&Value>) -> Result<Vec<String>, MediaWikiError> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let rows = value
        .as_array()
        .ok_or_else(|| MediaWikiError::InvalidResponse("parse.images must be an array".into()))?;
    rows.iter()
        .map(|row| {
            row.as_str().map(str::to_owned).ok_or_else(|| {
                MediaWikiError::InvalidResponse("parse.images entries must be strings".into())
            })
        })
        .collect()
}

fn parse_categories(value: Option<&Value>) -> Result<Vec<String>, MediaWikiError> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let rows = value.as_array().ok_or_else(|| {
        MediaWikiError::InvalidResponse("parse.categories must be an array".into())
    })?;
    rows.iter()
        .map(|row| {
            row.as_str()
                .or_else(|| row.get("category").and_then(Value::as_str))
                .or_else(|| row.get("*").and_then(Value::as_str))
                .map(str::to_owned)
                .ok_or_else(|| {
                    MediaWikiError::InvalidResponse("invalid MediaWiki category entry".into())
                })
        })
        .collect()
}

fn parse_string_array(value: Option<&Value>, field: &str) -> Result<Vec<String>, MediaWikiError> {
    let Some(value) = value else { return Ok(Vec::new()) };
    value
        .as_array()
        .ok_or_else(|| MediaWikiError::InvalidResponse(format!("{field} must be an array")))?
        .iter()
        .map(|entry| {
            entry.as_str().map(str::to_owned).ok_or_else(|| {
                MediaWikiError::InvalidResponse(format!("{field} entries must be strings"))
            })
        })
        .collect()
}

async fn resolve_images(
    client: &ObscuraHttpClient,
    options: &MediaWikiOptions,
    files: &[String],
    last_request: &mut Option<Instant>,
) -> Result<Vec<WikiImage>, MediaWikiError> {
    let mut images = Vec::new();
    for batch in files.chunks(50) {
        let titles = batch
            .iter()
            .map(
                |name| {
                    if has_file_namespace(name) { name.clone() } else { format!("File:{name}") }
                },
            )
            .collect::<Vec<_>>()
            .join("|");
        let params = [
            ("action", "query".to_owned()),
            ("format", "json".to_owned()),
            ("formatversion", "2".to_owned()),
            ("titles", titles),
            ("prop", "imageinfo".to_owned()),
            ("iiprop", "url|size|mime|sha1".to_owned()),
        ];
        let response = request_json(client, options, &params, last_request).await?;
        if let Some(message) = api_error(&response) {
            return Err(MediaWikiError::Api(message));
        }
        let pages =
            response.pointer("/query/pages").and_then(Value::as_array).ok_or_else(|| {
                MediaWikiError::InvalidResponse("image query.pages is missing or invalid".into())
            })?;
        for page in pages {
            let Some(info) = page.pointer("/imageinfo/0") else { continue };
            let raw_url = info.get("url").and_then(Value::as_str).ok_or_else(|| {
                MediaWikiError::InvalidResponse("imageinfo.url is missing".into())
            })?;
            let image_url = Url::parse(raw_url).map_err(|error| {
                MediaWikiError::InvalidResponse(format!("invalid original image URL: {error}"))
            })?;
            if !matches!(image_url.scheme(), "http" | "https")
                || !image_url.username().is_empty()
                || image_url.password().is_some()
            {
                return Err(MediaWikiError::InvalidResponse(
                    "original image URL must be credential-free HTTP(S)".into(),
                ));
            }
            images.push(WikiImage {
                fichier: page.get("title").and_then(Value::as_str).unwrap_or_default().to_owned(),
                url: image_url.to_string(),
                largeur: info.get("width").and_then(Value::as_u64),
                hauteur: info.get("height").and_then(Value::as_u64),
                mime: info.get("mime").and_then(Value::as_str).map(str::to_owned),
                sha1: info.get("sha1").and_then(Value::as_str).map(str::to_owned),
            });
        }
    }
    Ok(images)
}

fn has_file_namespace(title: &str) -> bool {
    title.split_once(':').is_some_and(|(namespace, _)| {
        matches!(
            namespace.to_ascii_lowercase().as_str(),
            "file"
                | "image"
                | "fichier"
                | "archivo"
                | "datei"
                | "ficheiro"
                | "bestand"
                | "fil"
                | "plik"
        )
    })
}

fn html_text(value: &str) -> String {
    let tree = obscura_dom::parse_fragment(value);
    normalize_space(&tree.text_content(tree.document()))
}

/// Parse MediaWiki data tables, expanding rowspan and colspan like the legacy consumer.
pub fn parse_tables(html: &str, page_url: Option<&str>) -> Vec<WikiTable> {
    let tree = parse_html(html);
    let Ok(table_nodes) = tree.query_selector_all("table") else { return Vec::new() };
    let mut output = Vec::new();
    for (index, table_id) in table_nodes.iter().copied().enumerate() {
        let Ok(row_nodes) = tree.query_selector_all("tr") else { continue };
        let rows = row_nodes
            .into_iter()
            .filter(|row| closest_table(&tree, *row) == Some(table_id))
            .collect::<Vec<_>>();
        let mut grid: Vec<Vec<String>> = Vec::new();
        let mut pending: BTreeMap<(usize, usize), String> = BTreeMap::new();
        for (row_index, row_id) in rows.iter().copied().enumerate() {
            let mut row = Vec::new();
            let mut column = 0usize;
            fill_pending(&mut row, &mut column, row_index, &pending);
            let cells = tree.children(row_id).into_iter().filter(|cell| {
                tree.get_node(*cell).is_some_and(|node| {
                    node.as_element().is_some_and(|name| matches!(name.local.as_ref(), "th" | "td"))
                })
            });
            for cell in cells {
                fill_pending(&mut row, &mut column, row_index, &pending);
                let text = cell_text(&tree, cell);
                let colspan = attr_u32(&tree, cell, "colspan").unwrap_or(1).clamp(1, 100) as usize;
                let rowspan = attr_u32(&tree, cell, "rowspan").unwrap_or(1).clamp(1, 100) as usize;
                for _ in 0..colspan {
                    row.push(text.clone());
                    for next_row in 1..rowspan {
                        pending.insert((row_index + next_row, column), text.clone());
                    }
                    column += 1;
                    fill_pending(&mut row, &mut column, row_index, &pending);
                }
            }
            if !row.is_empty() {
                grid.push(row);
            }
        }
        if grid.is_empty() {
            continue;
        }
        let mut headers = Vec::new();
        if rows.first().is_some_and(|row| {
            let cells = tree
                .children(*row)
                .into_iter()
                .filter_map(|cell| {
                    tree.get_node(cell)
                        .and_then(|node| node.as_element().map(|tag| (*tag.local).to_owned()))
                        .filter(|tag| matches!(tag.as_str(), "th" | "td"))
                })
                .collect::<Vec<_>>();
            !cells.is_empty() && cells.iter().all(|tag| tag == "th")
        }) {
            headers = grid.remove(0);
        }
        let caption = tree
            .children(table_id)
            .into_iter()
            .find(|child| {
                tree.get_node(*child)
                    .and_then(|node| node.as_element().map(|tag| (*tag.local).to_owned()))
                    .as_deref()
                    == Some("caption")
            })
            .map(|caption| cell_text(&tree, caption))
            .filter(|text| !text.is_empty())
            .or_else(|| previous_heading(&tree, table_id));
        let _ = page_url; // Reserved for future absolute-link rendering in cell text.
        output.push(WikiTable { index, titre: caption, entetes: headers, lignes: grid });
    }
    output
}

fn fill_pending(
    row: &mut Vec<String>,
    column: &mut usize,
    row_index: usize,
    pending: &BTreeMap<(usize, usize), String>,
) {
    while let Some(value) = pending.get(&(row_index, *column)) {
        row.push(value.clone());
        *column += 1;
    }
}

fn closest_table(tree: &DomTree, node: NodeId) -> Option<NodeId> {
    let mut current = tree.get_node(node)?.parent;
    while let Some(id) = current {
        let parent = tree.get_node(id)?;
        if parent.as_element().is_some_and(|name| (&*name.local) == "table") {
            return Some(id);
        }
        current = parent.parent;
    }
    None
}

fn attr_u32(tree: &DomTree, node: NodeId, name: &str) -> Option<u32> {
    tree.with_node(node, |node| node.get_attribute(name).and_then(|value| value.parse().ok()))
        .flatten()
}

fn cell_text(tree: &DomTree, node: NodeId) -> String {
    let mut text = String::new();
    for child in tree.descendants(node) {
        let Some(current) = tree.get_node(child) else { continue };
        if let NodeData::Text { contents } = &current.data {
            if !in_ignored_cell_subtree(tree, child) {
                text.push_str(contents);
                text.push(' ');
            }
        } else if current
            .as_element()
            .is_some_and(|name| matches!(name.local.as_ref(), "br" | "td" | "th" | "p" | "li"))
        {
            text.push(' ');
        }
    }
    normalize_space(&text)
}

fn in_ignored_cell_subtree(tree: &DomTree, node: NodeId) -> bool {
    tree.ancestors(node).into_iter().any(|ancestor| {
        tree.with_node(ancestor, |element| {
            let Some(name) = element.as_element() else { return false };
            if matches!(name.local.as_ref(), "script" | "style") {
                return true;
            }
            (&*name.local) == "sup"
                && element.get_attribute("class").is_some_and(|class| {
                    class.split_ascii_whitespace().any(|token| token == "reference")
                })
        })
        .unwrap_or(false)
    })
}

fn previous_heading(tree: &DomTree, node: NodeId) -> Option<String> {
    let mut current = node;
    for _ in 0..6 {
        let parent = tree.get_node(current)?.parent?;
        let siblings = tree.children(parent);
        let position = siblings.iter().position(|sibling| *sibling == current)?;
        for sibling in siblings[..position].iter().rev() {
            if let Some(title) = heading_text(tree, *sibling) {
                return Some(title);
            }
        }
        current = parent;
    }
    None
}

fn heading_text(tree: &DomTree, node: NodeId) -> Option<String> {
    let element = tree.get_node(node)?;
    let tag = element.as_element()?;
    let heading = matches!(tag.local.as_ref(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
    let wrapper = (&*tag.local) == "div"
        && element.get_attribute("class").is_some_and(|classes| {
            classes.split_ascii_whitespace().any(|class| class == "mw-heading")
        });
    if !heading && !wrapper {
        return None;
    }
    let title = cell_text(tree, node);
    (!title.is_empty()).then_some(title)
}

/// Extract named Infobox/Character templates without splitting nested links or templates.
pub fn parse_infobox(wikitext: &str) -> Vec<WikiInfobox> {
    let mut boxes = Vec::new();
    let mut cursor = 0usize;
    while let Some(relative) = wikitext.get(cursor..).and_then(|rest| rest.find("{{")) {
        let start = cursor + relative;
        let Some(end) = template_end(wikitext, start) else {
            cursor = start + 2;
            continue;
        };
        let body = &wikitext[start + 2..end - 2];
        let mut parts = split_top_level(body, '|');
        let name = parts.first().copied().unwrap_or_default().trim().to_ascii_lowercase();
        if name.contains("infobox") || name.contains("character") {
            let mut fields = WikiInfobox::new();
            for parameter in parts.drain(1..) {
                let Some((key, raw)) = split_top_level_once(parameter, '=') else { continue };
                let key = key.trim();
                if !valid_infobox_key(key) {
                    continue;
                }
                let raw = raw.trim();
                fields.insert(
                    key.to_owned(),
                    WikiInfoboxValue { brut: raw.to_owned(), propre: clean_wikitext(raw) },
                );
            }
            if !fields.is_empty() {
                boxes.push(fields);
            }
        }
        cursor = start + 2; // Continue inside the outer template to find nested infoboxes.
    }
    boxes
}

fn template_end(source: &str, start: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut depth = 0usize;
    let mut index = start;
    while index + 1 < bytes.len() {
        match (bytes[index], bytes[index + 1]) {
            (b'{', b'{') => {
                depth += 1;
                index += 2;
            },
            (b'}', b'}') if depth > 0 => {
                depth -= 1;
                index += 2;
                if depth == 0 {
                    return Some(index);
                }
            },
            _ => index += 1,
        }
    }
    None
}

fn split_top_level(source: &str, delimiter: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    let bytes = source.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if index + 1 < bytes.len()
            && (&bytes[index..index + 2] == b"{{" || &bytes[index..index + 2] == b"[[")
        {
            depth += 1;
            index += 2;
            continue;
        }
        if index + 1 < bytes.len()
            && (&bytes[index..index + 2] == b"}}" || &bytes[index..index + 2] == b"]]")
        {
            depth = depth.saturating_sub(1);
            index += 2;
            continue;
        }
        if depth == 0 && bytes[index] == delimiter as u8 {
            parts.push(&source[start..index]);
            start = index + 1;
        }
        index += 1;
    }
    parts.push(&source[start..]);
    parts
}

fn split_top_level_once(source: &str, delimiter: char) -> Option<(&str, &str)> {
    let index = split_top_level(source, delimiter).first()?.len();
    (index < source.len()).then(|| (&source[..index], &source[index + delimiter.len_utf8()..]))
}

fn valid_infobox_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 60
        && !key
            .chars()
            .any(|ch| matches!(ch, '\n' | '\r' | '[' | ']' | '{' | '}' | '<' | '>' | '|'))
}

fn clean_wikitext(value: &str) -> String {
    let mut text = value.to_owned();
    for _ in 0..8 {
        let before = text.clone();
        text = replace_balanced_links(&text);
        text = replace_balanced_templates(&text);
        if text == before {
            break;
        }
    }
    text = text
        .replace("'''", "")
        .replace("''", "")
        .replace("<br>", " · ")
        .replace("<br />", " · ")
        .replace("<br/>", " · ");
    let tree = obscura_dom::parse_fragment(&text);
    normalize_space(&tree.text_content(tree.document()))
}

fn replace_balanced_links(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0usize;
    while let Some(relative) = text.get(cursor..).and_then(|tail| tail.find("[[")) {
        let start = cursor + relative;
        output.push_str(&text[cursor..start]);
        let Some(end_relative) = text.get(start + 2..).and_then(|tail| tail.find("]]")) else {
            output.push_str(&text[start..]);
            return output;
        };
        let end = start + 2 + end_relative;
        let body = &text[start + 2..end];
        let label = body.rsplit('|').next().unwrap_or(body).trim();
        output.push_str(label);
        cursor = end + 2;
    }
    output.push_str(&text[cursor..]);
    output
}

fn replace_balanced_templates(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0usize;
    while let Some(relative) = text.get(cursor..).and_then(|tail| tail.find("{{")) {
        let start = cursor + relative;
        output.push_str(&text[cursor..start]);
        let Some(end) = template_end(text, start) else {
            output.push_str(&text[start..]);
            return output;
        };
        cursor = end;
    }
    output.push_str(&text[cursor..]);
    output
}

fn normalize_space(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn infobox_preserves_nested_raw_values_and_cleans_nested_markup() {
        let source = "{{Infobox character|name=[[Aphrodi|Aphrodi]]|details={{lang|ja|亜風炉}}|stats={{x|a=b}}}}";
        let boxes = parse_infobox(source);
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0]["name"].brut, "[[Aphrodi|Aphrodi]]");
        assert_eq!(boxes[0]["name"].propre, "Aphrodi");
        assert_eq!(boxes[0]["details"].brut, "{{lang|ja|亜風炉}}");
        assert_eq!(boxes[0]["details"].propre, "");
        assert_eq!(boxes[0]["stats"].brut, "{{x|a=b}}");
    }

    #[test]
    fn infobox_finds_nested_boxes_and_ignores_unclosed_templates() {
        let boxes = parse_infobox("{{outer|nested={{Infobox character|name=Goku}}}} {{Infobox|x");
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0]["name"].propre, "Goku");
    }

    #[test]
    fn html_tables_expand_rowspan_colspan_and_keep_nested_tables_separate() {
        let html = r#"<h2>Stats</h2><table><tr><th colspan="2">Hero</th></tr><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr><tr><td>outer<table><tr><td>inner</td></tr></table></td><td>x</td></tr></table>"#;
        let tables = parse_tables(html, None);
        assert_eq!(tables.len(), 2);
        assert_eq!(tables[0].titre.as_deref(), Some("Stats"));
        assert_eq!(tables[0].entetes, ["Hero", "Hero"]);
        assert_eq!(tables[0].lignes[0], ["A", "1"]);
        assert_eq!(tables[0].lignes[1], ["A", "2"]);
        assert_eq!(tables[1].lignes[0], ["inner"]);
    }

    #[test]
    fn page_parser_rejects_api_errors_and_malformed_required_fields() {
        assert_eq!(
            api_error(&json!({"error":{"code":"missingtitle","info":"no page"}})).as_deref(),
            Some("missingtitle: no page")
        );
        assert!(parse_sections(Some(&json!({"not":"an array"}))).is_err());
        assert!(parse_images(Some(&json!([1]))).is_err());
        assert!(parse_categories(Some(&json!([{"other":"bad"}]))).is_err());
    }

    #[test]
    fn page_url_resolves_title_query_and_encoded_article_paths() {
        let options = MediaWikiOptions::new(Url::parse("https://example.test/w/api.php").unwrap());
        assert_eq!(
            page_target("https://example.test/wiki/Aphrodi%20Terumi", &options).unwrap().1,
            "Aphrodi Terumi"
        );
        assert_eq!(
            page_target("https://example.test/w/index.php?title=Goku", &options).unwrap().1,
            "Goku"
        );
        assert!(page_target("https://other.test/wiki/Goku", &options).is_err());
    }

    #[tokio::test]
    async fn page_dossier_uses_local_mediawiki_and_resolves_full_image_urls() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let page_html = format!(
            "<main><h2>Profil</h2>{}<table><tr><th>Nom</th></tr><tr><td>Aphrodi</td></tr></table></main>",
            "<p>Prince du football et capitaine de l'équipe Zeus.</p>".repeat(12)
        );
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (index, payload) in [
                json!({"parse":{
                    "title":"Aphrodi","displaytitle":"<i>Aphrodi</i>","revid":77,
                    "text":page_html,
                    "wikitext":"{{Infobox character|name=[[Aphrodi|Aphrodi]]}}",
                    "sections":[{"level":"2","line":"Profil","anchor":"Profil"}],
                    "images":["File:Aphrodi.png"],"categories":[{"category":"Characters"}],
                    "externallinks":["https://example.org/source"]
                }}),
                json!({"query":{"pages":[{"title":"File:Aphrodi.png","imageinfo":[{
                    "url":"https://cdn.example/Aphrodi.png","width":640,"height":480,"mime":"image/png","sha1":"abc123"
                }]}]}}),
            ].into_iter().enumerate() {
                let (mut stream, _) = listener.accept().await.expect("accept");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2048];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).await.expect("read request");
                    assert!(count > 0 && request.len() < 16_384, "incomplete HTTP request");
                    request.extend_from_slice(&buffer[..count]);
                }
                let body = payload.to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.expect("response");
                requests.push(String::from_utf8(request).expect("request encoding"));
                let _ = index;
            }
            requests
        });
        let api = Url::parse(&format!("http://{address}/w/api.php")).expect("api URL");
        let mut client = ObscuraHttpClient::new();
        client.allow_private_network = true;
        client.timeout = std::time::Duration::from_secs(2);
        let mut options = MediaWikiOptions::new(api);
        options.request_interval = std::time::Duration::ZERO;
        let dossier = page_dossier(
            &client,
            &options,
            &format!("http://{address}/wiki/Aphrodi"),
            WikiPageOptions { include_images: true, include_content: true },
        )
        .await
        .expect("dossier");
        assert_eq!(dossier.titre, "Aphrodi");
        assert_eq!(dossier.revid, Some(77));
        assert_eq!(dossier.sections[0].niveau, 2);
        assert_eq!(dossier.infobox[0]["name"].propre, "Aphrodi");
        assert_eq!(dossier.tableaux[0].lignes, [["Aphrodi"]]);
        assert_eq!(dossier.images[0].url, "https://cdn.example/Aphrodi.png");
        assert_eq!(dossier.categories, ["Characters"]);
        assert_eq!(dossier.liens_externes, ["https://example.org/source"]);
        assert!(
            dossier
                .markdown
                .as_deref()
                .is_some_and(|markdown| markdown.contains("Prince du football"))
        );
        assert!(dossier.wikitext.as_deref().is_some_and(|text| text.contains("Infobox character")));
        let requests = server.await.expect("server");
        assert_eq!(requests.len(), 2);
        assert!(requests[0].contains("action=parse"));
        assert!(requests[1].contains("prop=imageinfo"));
    }

    #[tokio::test]
    async fn missing_page_api_errors_are_propagated_instead_of_empty_dossiers() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = stream.read(&mut buffer).await.expect("read request");
                assert!(count > 0 && request.len() < 16_384, "incomplete HTTP request");
                request.extend_from_slice(&buffer[..count]);
            }
            let body = r#"{"error":{"code":"missingtitle","info":"The page does not exist."}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.expect("response");
        });
        let api = Url::parse(&format!("http://{address}/w/api.php")).expect("api URL");
        let mut client = ObscuraHttpClient::new();
        client.allow_private_network = true;
        client.timeout = std::time::Duration::from_secs(2);
        let mut api_options = MediaWikiOptions::new(api);
        api_options.request_interval = std::time::Duration::ZERO;
        let error = page_dossier(
            &client,
            &api_options,
            &format!("http://{address}/wiki/Not_Found"),
            WikiPageOptions::default(),
        )
        .await
        .expect_err("missing page must fail");
        assert!(
            matches!(error, MediaWikiError::Api(message) if message.contains("missingtitle") && message.contains("does not exist"))
        );
        server.await.expect("server");
    }

    #[tokio::test]
    async fn unavailable_action_api_falls_back_to_real_rest_page_source() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let source =
            format!("{{{{Infobox character|name=Aphrodi}}}}\n{}", "long page source ".repeat(20));
        let server = tokio::spawn(async move {
            let mut paths = Vec::new();
            let payloads = [
                json!({"error":{"code":"readapidenied","info":"Action API disabled"}}),
                json!({"title":"Aphrodi","source":source,"latest":{"id":78}}),
            ];
            for payload in payloads {
                let (mut stream, _) = listener.accept().await.expect("accept");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).await.expect("read request");
                    assert!(count > 0 && request.len() < 16_384, "incomplete HTTP request");
                    request.extend_from_slice(&buffer[..count]);
                }
                paths.push(
                    String::from_utf8(request)
                        .expect("request encoding")
                        .lines()
                        .next()
                        .expect("request line")
                        .to_owned(),
                );
                let body = payload.to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.expect("response");
            }
            paths
        });
        let api = Url::parse(&format!("http://{address}/w/api.php")).expect("api URL");
        let mut client = ObscuraHttpClient::new();
        client.allow_private_network = true;
        client.timeout = std::time::Duration::from_secs(2);
        let mut api_options = MediaWikiOptions::new(api);
        api_options.request_interval = std::time::Duration::ZERO;
        let dossier = page_dossier(
            &client,
            &api_options,
            &format!("http://{address}/wiki/Aphrodi"),
            WikiPageOptions { include_images: false, include_content: true },
        )
        .await
        .expect("REST fallback dossier");
        assert_eq!(dossier.api, "rest.php");
        assert_eq!(dossier.titre, "Aphrodi");
        assert_eq!(dossier.revid, Some(78));
        assert_eq!(dossier.infobox[0]["name"].propre, "Aphrodi");
        assert!(dossier.markdown.as_deref().is_some_and(|text| text.starts_with("{{Infobox")));
        assert_eq!(dossier.mesures["octets_html"], 0);
        let paths = server.await.expect("server");
        assert!(paths[0].contains("/w/api.php?action=parse"));
        assert!(paths[1].contains("/w/rest.php/v1/page/Aphrodi"));
    }
}
