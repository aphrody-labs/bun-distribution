// SPDX-License-Identifier: Apache-2.0
// Domain extraction migrated from integrated BXC's dragonball and JSONL modules.
use obscura_dom::{DomTree, parse_html};
use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct DialogueNode {
    pub speaker: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeSynopsis {
    pub series: String,
    pub episode_number: u32,
    pub title: String,
    pub synopsis: String,
    pub broadcast_date: Option<String>,
    pub image_url: Option<String>,
    pub source_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JumpStatistic {
    pub issue: String,
    pub year: Option<u32>,
    pub rank: Option<u32>,
    pub title: String,
    pub cover: bool,
    pub color_pages: bool,
}

#[doc(hidden)]
pub fn text(dom: &DomTree, selector: &str) -> Option<String> {
    dom.query_selector(selector)
        .ok()
        .flatten()
        .map(|id| dom.text_content(id).split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|value| !value.is_empty())
}

#[doc(hidden)]
pub fn attribute(dom: &DomTree, selector: &str, attribute: &str) -> Option<String> {
    dom.query_selector(selector)
        .ok()
        .flatten()
        .and_then(|id| dom.with_node(id, |node| node.get_attribute(attribute).map(str::to_owned)))
        .flatten()
}

pub fn parse_toei_episodes(html: &str, source: &Url) -> Vec<EpisodeSynopsis> {
    let dom = parse_html(html);
    let route = Regex::new(r"/ja/tv/([^/]+)/episode/(\d+)?").expect("static Toei route");
    let Some(capture) = route.captures(source.path()) else { return Vec::new() };
    let series = match &capture[1] {
        "dragon" => "dragon_ball",
        "dragonz" => "dragon_ball_z",
        "dragon_gt" => "dragon_gt",
        "dragon_kai" => "dragon_ball_kai",
        "dragon_super" | "dragonball_super" => "dragon_ball_super",
        "dragonball_daima" => "dragonball_daima",
        value => value,
    }
    .to_owned();
    let date = Regex::new(r"\d{4}/\d{2}/\d{2}").expect("static broadcast date");
    let number = Regex::new(r"第?\s*(\d+)\s*話").expect("static episode number");
    if let Some(number) = capture.get(2).and_then(|value| value.as_str().parse().ok()) {
        return vec![EpisodeSynopsis {
            series,
            episode_number: number,
            title: text(&dom, ".story_caption_title")
                .or_else(|| text(&dom, "h1"))
                .or_else(|| text(&dom, "title"))
                .unwrap_or_default(),
            synopsis: text(&dom, ".text_details_inner")
                .or_else(|| text(&dom, "p.text"))
                .unwrap_or_default(),
            broadcast_date: date
                .find(&dom.text_content(dom.document()))
                .map(|value| value.as_str().into()),
            image_url: attribute(&dom, "img[src*='/upload/save_image/episode/']", "src")
                .and_then(|src| source.join(&src).ok())
                .map(|url| url.to_string()),
            source_url: source.to_string(),
        }];
    }
    let mut episodes = std::collections::BTreeMap::new();
    for id in dom.query_selector_all("dt").unwrap_or_default() {
        let title = dom.text_content(id);
        let Some(number) = number.captures(&title).and_then(|capture| capture[1].parse().ok())
        else {
            continue;
        };
        let mut next = dom.with_node(id, |node| node.next_sibling).flatten();
        let mut synopsis = String::new();
        while let Some(sibling) = next {
            let is_element = dom.with_node(sibling, |node| node.is_element()).unwrap_or(false);
            if is_element {
                if dom
                    .with_node(sibling, |node| {
                        node.as_element().is_some_and(|name| {
                            let local: &str = name.local.as_ref();
                            local == "dd"
                        })
                    })
                    .unwrap_or(false)
                {
                    synopsis = dom.text_content(sibling);
                }
                break;
            }
            next = dom.with_node(sibling, |node| node.next_sibling).flatten();
        }
        episodes.insert(
            number,
            EpisodeSynopsis {
                series: series.clone(),
                episode_number: number,
                title,
                synopsis,
                broadcast_date: None,
                image_url: None,
                source_url: source.to_string(),
            },
        );
    }
    for id in dom.query_selector_all(".epOne").unwrap_or_default() {
        let node = parse_html(&dom.inner_html(id));
        let label = text(&node, ".num").unwrap_or_else(|| dom.text_content(id));
        let Some(number) = number.captures(&label).and_then(|capture| capture[1].parse().ok())
        else {
            continue;
        };
        let title = text(&node, ".title").unwrap_or(label);
        let image = attribute(&node, "img[src]", "src")
            .and_then(|src| source.join(&src).ok())
            .map(|url| url.to_string());
        let mut url = source.clone();
        url.set_path(&format!("/ja/tv/{}/episode/{number}/", &capture[1]));
        let entry = episodes.entry(number).or_insert(EpisodeSynopsis {
            series: series.clone(),
            episode_number: number,
            title: title.clone(),
            synopsis: String::new(),
            broadcast_date: None,
            image_url: None,
            source_url: url.to_string(),
        });
        entry.title = title;
        entry.image_url = image;
    }
    episodes.into_values().collect()
}

pub fn parse_jump_statistics(html: &str) -> Vec<JumpStatistic> {
    let dom = parse_html(html);
    let year = Regex::new(r"(?:19|20)\d{2}").expect("static Jump year");
    dom.query_selector_all("tr")
        .unwrap_or_default()
        .into_iter()
        .filter_map(|id| {
            let cell = |selector: &str| {
                dom.query_selector_from(id, selector)
                    .ok()
                    .flatten()
                    .map(|id| dom.text_content(id).split_whitespace().collect::<Vec<_>>().join(" "))
            };
            let issue = cell(".issue")?;
            let title = cell(".title")?;
            let rank = cell(".order").and_then(|value| value.parse().ok());
            let full = dom.text_content(id);
            Some(JumpStatistic {
                year: year.find(&issue).and_then(|value| value.as_str().parse().ok()),
                issue,
                rank,
                title,
                cover: full.contains("表紙"),
                color_pages: full.contains("巻頭") || full.contains("カラー"),
            })
        })
        .collect()
}

#[derive(Default, Debug, Deserialize, Serialize)]
pub struct Translation {
    pub title: Option<String>,
    pub original_print_source: Option<String>,
    pub publication_date: Option<String>,
    pub people: Vec<String>,
    pub dialogue: Vec<DialogueNode>,
}

pub fn parse_translation(html: &str) -> Translation {
    let dom = parse_html(html);
    let content = dom
        .query_selector("#trans-content")
        .ok()
        .flatten()
        .map(|id| dom.inner_html(id))
        .unwrap_or_else(|| html.into());
    let dom = parse_html(&content);
    let title = text(&dom, "h1");
    let original_print_source = text(&dom, "h2");
    let date =
        Regex::new(r"\b(?:\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}\.\d{2}\.\d{2}|[A-Za-z]+\s+\d{4})\b")
            .expect("static translation date");
    let publication_date = original_print_source
        .as_deref()
        .and_then(|value| date.find(value))
        .or_else(|| date.find(&content))
        .map(|value| value.as_str().into());
    let mut people = Vec::new();
    let interviewer = Regex::new(r"(?:Interviewer|Interviewed by|Interviewers):\s*([^<\n]+)")
        .expect("static interviewer regex");
    if let Some(capture) = interviewer.captures(&content) {
        let person = capture[1].trim().to_owned();
        if !person.is_empty() {
            people.push(person);
        }
    }
    if title.as_deref().is_some_and(|title| title.contains("Akira Toriyama")) {
        people.push("Akira Toriyama".into());
    }
    let mut dialogue = Vec::new();
    for id in dom.query_selector_all(".question, .answer, p").unwrap_or_default() {
        let class = dom
            .with_node(id, |node| node.get_attribute("class").map(str::to_owned))
            .flatten()
            .unwrap_or_default();
        let body = dom.text_content(id).split_whitespace().collect::<Vec<_>>().join(" ");
        if body.is_empty() {
            continue;
        }
        if class.split_whitespace().any(|value| value == "answer")
            && dom.query_selector_from(id, "p").ok().flatten().is_some()
        {
            continue;
        }
        let person = dom
            .query_selector_from(id, "strong")
            .ok()
            .flatten()
            .map(|id| dom.text_content(id).trim().trim_end_matches(':').to_owned())
            .filter(|value| !value.is_empty() && value.chars().count() < 50);
        if let Some(person) = person {
            if !people.contains(&person) {
                people.push(person.clone());
            }
            let text = body
                .strip_prefix(&person)
                .unwrap_or(&body)
                .trim_start_matches(':')
                .trim()
                .to_owned();
            if !text.is_empty() {
                dialogue.push(DialogueNode { speaker: person, content: text });
            }
        } else if class.split_whitespace().any(|value| value == "question") {
            dialogue.push(DialogueNode { speaker: "Question".into(), content: body });
        } else if class.split_whitespace().any(|value| value == "answer")
            && dom.query_selector_from(id, "p").ok().flatten().is_none()
        {
            dialogue.push(DialogueNode { speaker: "Answer".into(), content: body });
        }
    }
    Translation { title, original_print_source, publication_date, people, dialogue }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publisher_episode_and_jump_stat_fields_are_not_invented() {
        let episodes = parse_toei_episodes(
            "<h1 class='story_caption_title'>Goku</h1><div class='text_details_inner'>Synopsis</div><p>1989/04/26<span>放送</span></p>",
            &Url::parse("https://lineup.toei-anim.co.jp/ja/tv/dragonz/episode/1/").unwrap(),
        );
        assert_eq!(episodes[0].episode_number, 1);
        assert_eq!(episodes[0].broadcast_date.as_deref(), Some("1989/04/26"));
        let stats = parse_jump_statistics(
            "<table><tr><td class='issue'>1984 #51</td><td class='title'>Dragon Ball</td><td class='order'>3</td><td>表紙 カラー</td></tr><tr><td class='issue'>?</td><td class='title'>Unknown</td></tr></table>",
        );
        assert_eq!(stats[0].rank, Some(3));
        assert!(stats[0].cover);
        assert!(stats[1].year.is_none());
        assert!(stats[1].rank.is_none());
    }
    #[test]
    fn kanzenshuu_qa_retains_print_source_and_speakers() {
        let parsed = parse_translation(
            "<div id='trans-content'><h1>Akira Toriyama interview</h1><h2>Daizenshuu 1, July 1995</h2><div class='question'>Why?</div><div class='answer'><p><strong>Toriyama:</strong> Because!</p></div></div>",
        );
        assert_eq!(parsed.original_print_source.as_deref(), Some("Daizenshuu 1, July 1995"));
        assert_eq!(parsed.dialogue.len(), 2);
        assert_eq!(parsed.dialogue[1].speaker, "Toriyama");
    }
}
