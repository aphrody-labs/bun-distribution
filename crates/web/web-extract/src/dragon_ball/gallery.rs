// SPDX-License-Identifier: Apache-2.0
// Derived from Shenron 902432cf packages/pipeline/src/dragonballcn-gallery.ts
// and scripts/volumetrie-dragonballcn.ts (Apache-2.0).
use obscura_dom::parse_html;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPage {
    pub page_number: usize,
    pub name: String,
    pub thumb_url: String,
    pub image_url: String,
    pub page_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Gallery {
    pub title: Option<String>,
    pub directory: Option<String>,
    pub files: Vec<String>,
    pub total_pages: usize,
    pub pages: Vec<GalleryPage>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Plate {
    pub n: u32,
    #[serde(rename = "fichier")]
    pub file: String,
    #[serde(rename = "poids")]
    pub size: Option<String>,
    #[serde(rename = "ajoutee")]
    pub added: Option<String>,
}

pub fn parse_gallery(html: &str, did: &str, base: &Url) -> Gallery {
    let dom = parse_html(html);
    let title = dom.query_selector("title").ok().flatten().map(|id| {
        let title = dom.text_content(id);
        title.split('-').next().unwrap_or_default().trim().to_owned()
    });
    let pattern = Regex::new(r"^/list/+(.+)/_thumb\.([^/]+)$").expect("static gallery regex");
    let source_pattern =
        Regex::new(r"/list/+(.+)/_thumb\.([^/]+)$").expect("static gallery source name regex");
    let mut seen = HashSet::new();
    let mut pages = Vec::new();
    let mut directory = None;
    for id in dom.query_selector_all("img[src]").unwrap_or_default() {
        let Some(src) =
            dom.with_node(id, |node| node.get_attribute("src").map(str::to_owned)).flatten()
        else {
            continue;
        };
        let Ok(url) = base.join(&src) else { continue };
        if url.origin() != base.origin() {
            continue;
        }
        let Some(capture) = pattern.captures(url.path()) else { continue };
        // URL transport paths are encoded; bibliographic inventory names keep
        // their original Unicode and spaces as declared in the source markup.
        let source_path = src.split(['?', '#']).next().unwrap_or(&src);
        let source_capture = source_pattern.captures(source_path);
        let dir = source_capture
            .as_ref()
            .map_or(&capture[1], |value| value.get(1).map_or(&capture[1], |value| value.as_str()));
        let file = source_capture
            .as_ref()
            .map_or(&capture[2], |value| value.get(2).map_or(&capture[2], |value| value.as_str()));
        if !seen.insert(file.to_owned()) {
            continue;
        }
        if directory.is_none() {
            directory = Some(dir.to_owned());
        }
        let (Ok(image), Ok(thumb), Ok(mut viewer)) = (
            base.join(&format!("/list/{dir}/{file}")),
            base.join(&format!("/list/{dir}/_thumb.{file}")),
            base.join("/list/gain_1.php"),
        ) else {
            continue;
        };
        if image.path().contains("/../") || thumb.path().contains("/../") {
            continue;
        }
        let encoded = url::form_urlencoded::byte_serialize(did.as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        viewer.set_query(Some(&format!("did={encoded}")));
        let page_number = pages.len() + 1;
        viewer.set_fragment(Some(&format!("page_{page_number}")));
        pages.push(GalleryPage {
            page_number,
            name: file.into(),
            thumb_url: thumb.to_string(),
            image_url: image.to_string(),
            page_url: viewer.to_string(),
        });
    }
    Gallery {
        title,
        directory,
        files: pages.iter().map(|page| page.name.clone()).collect(),
        total_pages: pages.len(),
        pages,
    }
}

pub fn parse_plate_inventory(markdown: &str) -> Vec<Plate> {
    let pattern = Regex::new(r"(?i)\[([^\]]+\.(?:jpg|jpeg|png|gif|webp))\]\([^)]*[?&]fid=(\d+)\)")
        .expect("static plate regex");
    let size = Regex::new(r"(?i)([\d.]+\s*[km]b)").expect("static size regex");
    let date = Regex::new(r"\d{4}-\d{2}-\d{2}").expect("static date regex");
    let lines: Vec<_> = markdown.lines().collect();
    let mut plates = BTreeMap::new();
    for (index, line) in lines.iter().enumerate() {
        let Some(capture) = pattern.captures(line) else { continue };
        let Ok(n) = capture[2].parse() else { continue };
        plates.entry(n).or_insert_with(|| Plate {
            n,
            file: capture[1].replace("\\_", "_"),
            size: lines
                .get(index + 1)
                .and_then(|line| size.find(line))
                .map(|value| value.as_str().into()),
            added: lines
                .get(index + 2)
                .and_then(|line| date.find(line))
                .map(|value| value.as_str().into()),
        });
    }
    plates.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shenron_gallery_contract_preserves_order_and_deduplicates() {
        let html = "<title>Vol 1 - 龙珠中文网</title><img src='/list//db/v01/_thumb.001.jpg'><img src='/list/db/v01/_thumb.002.jpg'><img src='/list/db/v01/_thumb.001.jpg'>";
        let gallery =
            parse_gallery(html, "a b", &Url::parse("https://comic.dragonballcn.com").unwrap());
        assert_eq!(gallery.title.as_deref(), Some("Vol 1"));
        assert_eq!(gallery.directory.as_deref(), Some("db/v01"));
        assert_eq!(gallery.files, ["001.jpg", "002.jpg"]);
        assert_eq!(
            gallery.pages[1].page_url,
            "https://comic.dragonballcn.com/list/gain_1.php?did=a%20b#page_2"
        );
        assert_eq!(
            gallery.pages[1].image_url,
            "https://comic.dragonballcn.com/list/db/v01/002.jpg"
        );
    }
    #[test]
    fn pagination_has_unknown_fields_and_double_page_names() {
        let plates = parse_plate_inventory(
            "* [DB02\\_044-045.jpg](gain_1.php?did=0-1-1&fid=2)\n1.2 Mb\n2026-01-02\n* [x.jpg](?fid=1)\nunknown\nunknown\n* [duplicate.jpg](?fid=2)",
        );
        assert_eq!(plates.len(), 2);
        assert_eq!(plates[0].n, 1);
        assert!(plates[0].size.is_none());
        assert_eq!(plates[1].file, "DB02_044-045.jpg");
        assert_eq!(plates[1].added.as_deref(), Some("2026-01-02"));
    }
    #[test]
    fn source_unicode_names_survive_transport_url_encoding() {
        let gallery = parse_gallery(
            "<img src='/list/原稿 資料/_thumb.第 01話.jpg'>",
            "0-1",
            &Url::parse("https://comic.dragonballcn.com/").unwrap(),
        );
        assert_eq!(gallery.directory.as_deref(), Some("原稿 資料"));
        assert_eq!(gallery.files, vec!["第 01話.jpg"]);
        assert_eq!(gallery.pages[0].name, "第 01話.jpg");
        assert!(gallery.pages[0].image_url.contains("%20"));
        assert!(!gallery.pages[0].image_url.contains("_thumb."));
    }
}
