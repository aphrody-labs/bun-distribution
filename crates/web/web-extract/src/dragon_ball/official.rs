// SPDX-License-Identifier: Apache-2.0
// Contract derived from integrated BXC apps/bxc/src/cli/dragonball.ts.
use super::structured::{attribute, text};
use obscura_dom::parse_html;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfficialArticle {
    pub id: String,
    pub title: String,
    pub url: String,
    pub category: Option<String>,
    pub date: Option<String>,
    pub image_url: Option<String>,
    pub summary: Option<String>,
    pub content_markdown: Option<String>,
    pub source: String,
    pub tags: Vec<String>,
    pub gallery_urls: Vec<String>,
}

/// Parse listing cards or a detailed official article without invented dates.
pub fn parse_official_articles(html: &str, source: &Url) -> Vec<OfficialArticle> {
    let dom = parse_html(html);
    let date = Regex::new(r"\b20\d{2}\.\d{2}\.\d{2}\b").expect("static official date");
    let make = |url: &Url, content: &str| {
        let dom = parse_html(content);
        let title = text(&dom, ".news-post__title, p.title, h1, h2, h3")
            .or_else(|| attribute(&dom, "meta[property='og:title']", "content"))
            .unwrap_or_else(|| {
                dom.text_content(dom.document()).split_whitespace().collect::<Vec<_>>().join(" ")
            });
        let title =
            title.split("| DRAGON BALL OFFICIAL SITE").next().unwrap_or(&title).trim().to_owned();
        let body = dom
            .query_selector(".entry-article, .news-post__body")
            .ok()
            .flatten()
            .map(|id| crate::html_to_markdown(&dom.inner_html(id), Some(url.as_str())))
            .filter(|value| !value.trim().is_empty());
        let tags = dom
            .query_selector_all("li.tags__item a")
            .unwrap_or_default()
            .into_iter()
            .map(|id| dom.text_content(id).trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect();
        let mut gallery = Vec::new();
        for id in dom
            .query_selector_all(
                ".c-gallery img, .photo-panel img, .entry-article img, img[src*='/news/20']",
            )
            .unwrap_or_default()
        {
            if let Some(raw) =
                dom.with_node(id, |node| node.get_attribute("src").map(str::to_owned)).flatten()
                && !raw.contains("assets/img")
                && let Ok(image) = url.join(&raw)
                && matches!(image.scheme(), "http" | "https")
                && !gallery.contains(&image.to_string())
            {
                gallery.push(image.to_string());
            }
        }
        let image = attribute(&dom, "meta[property='og:image']", "content")
            .or_else(|| attribute(&dom, "img", "src"))
            .and_then(|raw| url.join(&raw).ok())
            .filter(|image| matches!(image.scheme(), "http" | "https"))
            .map(|url| url.to_string())
            .or_else(|| gallery.first().cloned());
        OfficialArticle {
            id: url
                .path()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
                .collect(),
            title,
            url: url.to_string(),
            category: text(&dom, "span.category, span.cat"),
            date: attribute(&dom, "time[datetime]", "datetime")
                .or_else(|| text(&dom, "time"))
                .or_else(|| {
                    date.find(&dom.text_content(dom.document())).map(|value| value.as_str().into())
                }),
            image_url: image,
            summary: body.as_ref().map(|value| value.chars().take(300).collect()),
            content_markdown: body,
            source: "dragon-ball-official.com".into(),
            tags,
            gallery_urls: gallery,
        }
    };
    if source.path().contains("/news/") && source.path().ends_with(".html") {
        return vec![make(source, html)];
    }
    let mut articles = BTreeMap::new();
    for id in dom.query_selector_all("a[href*='/news/']").unwrap_or_default() {
        let Some(raw) =
            dom.with_node(id, |node| node.get_attribute("href").map(str::to_owned)).flatten()
        else {
            continue;
        };
        let Ok(url) = source.join(&raw) else { continue };
        if url.host_str() != source.host_str() || !url.path().ends_with(".html") {
            continue;
        }
        let article = make(&url, &dom.inner_html(id));
        if !article.title.is_empty() {
            articles.entry(url.to_string()).or_insert(article);
        }
    }
    articles.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_detail_retains_tags_gallery_and_missing_dates() {
        let url = Url::parse("https://dragon-ball-official.com/news/01_42.html").unwrap();
        let html = "<h3 class='news-post__title'>Toriyama &amp; interview</h3><span class='category'>Interview</span><ul><li class='tags__item'><a>Toriyama</a></li></ul><div class='entry-article'><p>Recorded evidence.</p><img src='/news/2026/10/photo.jpg'></div>";
        let articles = parse_official_articles(html, &url);
        assert_eq!(articles[0].title, "Toriyama & interview");
        assert_eq!(articles[0].date, None);
        assert_eq!(articles[0].tags, vec!["Toriyama"]);
        assert_eq!(
            articles[0].gallery_urls,
            vec!["https://dragon-ball-official.com/news/2026/10/photo.jpg"]
        );
        assert!(articles[0].content_markdown.as_ref().unwrap().contains("Recorded evidence."));
    }
}
