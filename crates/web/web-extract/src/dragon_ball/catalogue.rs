// SPDX-License-Identifier: Apache-2.0
// Derived from Shenron crawl-dragonballcn.ts and enrichit-divers-dragonballcn.ts.
use super::Gallery;
use obscura_dom::parse_html;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use url::Url;

pub const EDITIONS: &[&str] = &[
    "dragonball_jp_original",
    "dragonball_jp_kanzenban",
    "dragonball_full_color",
    "dragonball_zh_cn",
    "dragonball_zh_tw",
    "dragonball_zh_hk_ultimate",
    "dragonball_anime_z",
    "dragonball_anime_movie",
    "arale_cn",
    "arale_jp_lib",
    "arale_zh_hk",
];

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct Publication {
    pub did: String,
    pub url: String,
    #[serde(rename = "libelle")]
    pub label: String,
    #[serde(rename = "couverture")]
    pub cover: Option<String>,
    #[serde(rename = "titre_tome")]
    pub title: Option<String>,
    #[serde(rename = "premiere_edition")]
    pub first_edition: Option<String>,
    pub isbn: Option<String>,
    pub magazine: Option<String>,
    #[serde(rename = "prix")]
    pub price: Option<String>,
    #[serde(rename = "editeur")]
    pub publisher: Option<String>,
    #[serde(rename = "lignes")]
    pub lines: Vec<String>,
    #[serde(rename = "rubrique")]
    pub section: Option<String>,
    #[serde(rename = "rubrique_icone")]
    pub section_icon: Option<String>,
    #[serde(rename = "date_affichee")]
    pub display_date: Option<String>,
    #[serde(rename = "parution")]
    pub publication_date: Option<String>,
    #[serde(rename = "numerisation")]
    pub scanned_date: Option<String>,
    #[serde(rename = "fil_forum")]
    pub forum_thread: Option<String>,
    #[serde(rename = "planches")]
    pub plates: Option<usize>,
    pub gallery: Option<Gallery>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Collection {
    pub slug: String,
    #[serde(rename = "titre")]
    pub title: String,
    #[serde(rename = "titre_site")]
    pub source_title: Option<String>,
    pub url: String,
    #[serde(rename = "ouvrages")]
    pub publications: Vec<Publication>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Catalogue {
    pub source: String,
    #[serde(rename = "releve_le")]
    pub fetched_at: String,
    #[serde(rename = "avertissement")]
    pub notice: String,
    pub collections: Vec<Collection>,
}

fn lines(html: &str) -> Vec<String> {
    // Publisher fields are plain facts; Markdown escaping changes bracketed
    // dates and must not become part of their parsed values.
    let breaks = Regex::new(r"(?i)<br\s*/?>").expect("static metadata line break regex");
    let html = breaks.replace_all(html, "\n");
    let dom = parse_html(&html);
    dom.text_content(dom.document())
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn field(lines: &[String], prefix: &str) -> Option<String> {
    lines
        .iter()
        .find_map(|line| line.strip_prefix(prefix).map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub fn parse_collection(html: &str, slug: &str, base: &Url) -> Collection {
    let dom = parse_html(html);
    let mut publications = Vec::new();
    let mut seen = HashSet::new();
    for id in dom.query_selector_all("a[href]").unwrap_or_default() {
        let Some(href) =
            dom.with_node(id, |node| node.get_attribute("href").map(str::to_owned)).flatten()
        else {
            continue;
        };
        let Ok(url) = base.join(&href) else { continue };
        if url.origin() != base.origin() || !url.path().ends_with("gain_1.php") {
            continue;
        }
        let Some(did) =
            url.query_pairs().find(|(key, _)| key == "did").map(|(_, value)| value.into_owned())
        else {
            continue;
        };
        if !seen.insert(did.clone()) {
            continue;
        }
        let inner = dom.inner_html(id);
        let child = parse_html(&inner);
        let cover = child
            .query_selector("img[src]")
            .ok()
            .flatten()
            .and_then(|id| child.with_node(id, |node| node.get_attribute("src").map(str::to_owned)))
            .flatten()
            .and_then(|src| base.join(&src).ok())
            .filter(|url| url.origin() == base.origin())
            .map(|url| url.to_string());
        publications.push(Publication {
            did,
            url: url.to_string(),
            label: dom.text_content(id).split_whitespace().collect::<Vec<_>>().join(" "),
            cover,
            ..Publication::default()
        });
    }
    let blocks: Vec<_> = dom
        .query_selector_all("div[align='left']")
        .unwrap_or_default()
        .into_iter()
        .map(|id| lines(&dom.inner_html(id)))
        .collect();
    if blocks.len() == publications.len() {
        for (publication, lines) in publications.iter_mut().zip(blocks) {
            publication.title = lines.first().cloned();
            publication.first_edition = field(&lines, "初版");
            publication.isbn = field(&lines, "ISBN").filter(|value| value != "?");
            publication.magazine = field(&lines, "雜誌");
            publication.price = field(&lines, "定価");
            publication.publisher = field(&lines, "出版");
            publication.lines = lines;
        }
    }
    let rows = dom.query_selector_all("tr").unwrap_or_default();
    let date = Regex::new(r"\[(\d{4})-(\d{2})-(\d{2})\]").expect("static date regex");
    let isbn = Regex::new(r"(?i)ISBN\s+([\dX-]{8,})").expect("static ISBN regex");
    for pair in rows.windows(2) {
        let first_cells = dom.query_selector_all_from(pair[0], "td").unwrap_or_default();
        let next_cells = dom.query_selector_all_from(pair[1], "td").unwrap_or_default();
        if first_cells.len() != next_cells.len() {
            continue;
        }
        for (first_id, next_id) in first_cells.into_iter().zip(next_cells) {
            let Some(id) =
                dom.query_selector_from(first_id, "a[href*='gain_1.php']").ok().flatten()
            else {
                continue;
            };
            let Some(href) =
                dom.with_node(id, |node| node.get_attribute("href").map(str::to_owned)).flatten()
            else {
                continue;
            };
            let Some(did) = base.join(&href).ok().and_then(|url| {
                url.query_pairs().find(|(key, _)| key == "did").map(|(_, value)| value.into_owned())
            }) else {
                continue;
            };
            let Some(publication) = publications
                .iter_mut()
                .find(|publication| publication.did == did && publication.isbn.is_none())
            else {
                continue;
            };
            let metadata = lines(&dom.inner_html(next_id));
            let text = metadata.join(" ");
            publication.isbn = isbn.captures(&text).map(|value| value[1].into());
            if let Some(capture) = date.captures(&text) {
                publication.first_edition =
                    Some(format!("{}/{}/{}", &capture[1], &capture[2], &capture[3]));
            }
            if let Some(title) = metadata.first() {
                publication.title = Some(date.replace(title, "").trim().to_owned());
            }
            publication.lines = metadata;
        }
    }
    let source_title = dom
        .query_selector("title")
        .ok()
        .flatten()
        .map(|id| dom.text_content(id).split('-').next().unwrap_or_default().trim().to_owned());
    Collection {
        slug: slug.into(),
        title: source_title.clone().unwrap_or_else(|| slug.into()),
        source_title,
        url: base.to_string(),
        publications,
    }
}

pub fn parse_miscellaneous(html: &str, base: &Url) -> HashMap<String, Publication> {
    let dom = parse_html(html);
    let mut result = HashMap::new();
    let date = Regex::new(r"\[([^\]]+)\]").expect("static index date regex");
    let forum_pattern =
        Regex::new(r#"https?://bbs\.dragonballcn\.com[^\s\"'<>]+"#).expect("static forum regex");
    for section_id in dom.query_selector_all("div.it").unwrap_or_default() {
        let section = parse_html(&dom.inner_html(section_id));
        let title = section.query_selector("h4").ok().flatten().map(|id| section.text_content(id));
        let icon = section
            .query_selector("img.folder-thumb[src]")
            .ok()
            .flatten()
            .and_then(|id| {
                section.with_node(id, |node| node.get_attribute("src").map(str::to_owned))
            })
            .flatten()
            .and_then(|src| base.join(&src).ok())
            .map(|url| url.to_string());
        for id in section.query_selector_all("li").unwrap_or_default() {
            let inner = section.inner_html(id);
            let collection = parse_collection(&inner, "divers", base);
            let forum = forum_pattern.find(&inner).map(|value| value.as_str().into());
            let date_value =
                date.captures(&section.text_content(id)).map(|capture| capture[1].to_owned());
            for mut publication in collection.publications {
                publication.section = title.clone();
                publication.section_icon = icon.clone();
                publication.display_date = date_value.clone();
                if let Some(date) = &date_value {
                    let mut parts = date.split('|').map(str::trim);
                    publication.publication_date =
                        parts.next().filter(|value| !value.is_empty()).map(str::to_owned);
                    publication.scanned_date =
                        parts.next().filter(|value| !value.is_empty()).map(str::to_owned);
                }
                publication.forum_thread = forum.clone();
                result.entry(publication.did.clone()).or_insert(publication);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_publisher_and_hong_kong_table_fields_survive() {
        let base = Url::parse("https://comic.dragonballcn.com/dragonball_jp_original.htm").unwrap();
        let html = "<a href='list/gain_1.php?did=0-1'><img src='images/cover/one.jpg'>Volume 1</a><div align='left'>Title<br>初版 1985/09<br>ISBN 978-0000000001<br>出版 集英社</div>";
        let collection = parse_collection(html, "original", &base);
        assert_eq!(collection.publications[0].isbn.as_deref(), Some("978-0000000001"));
        assert_eq!(collection.publications[0].publisher.as_deref(), Some("集英社"));
        let html = "<table><tr><td><a href='list/gain_1.php?did=0-1'>one</a></td></tr><tr><td>[1993-08-20] 04 title<br>ISBN 962-585-004-X</td></tr></table>";
        let collection = parse_collection(html, "hongkong", &base);
        assert_eq!(collection.publications[0].isbn.as_deref(), Some("962-585-004-X"));
        assert_eq!(collection.publications[0].first_edition.as_deref(), Some("1993/08/20"));
    }
    #[test]
    fn source_section_icon_is_not_promoted_to_a_book_cover() {
        let metadata = parse_miscellaneous(
            "<div class='it'><h4>资料书籍</h4><img class='folder-thumb' src='/folder.gif'><li><font>[1985|2013]</font><a href='list/gain_1.php?did=1-2'>Book</a><a href='https://bbs.dragonballcn.com/thread'>source</a></li></div>",
            &Url::parse("https://comic.dragonballcn.com/").unwrap(),
        );
        let publication = &metadata["1-2"];
        assert!(publication.cover.is_none());
        assert_eq!(publication.publication_date.as_deref(), Some("1985"));
        assert_eq!(publication.scanned_date.as_deref(), Some("2013"));
        assert_eq!(publication.section.as_deref(), Some("资料书籍"));
    }
}
