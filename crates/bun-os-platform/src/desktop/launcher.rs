// SPDX-License-Identifier: Apache-2.0
//! Launcher: the COSMIC launcher / pop-launcher model as one controller-friendly search across
//! games, apps, settings pages and actions.
//!
//! pop-launcher routes a query to plugins by prefix and ranks their results; here providers are
//! fixed kinds plus plugin ids, a query may start with a provider prefix (`g `, `a `, `s `, `> `),
//! and ranking is a subsequence match that favours prefixes and word starts, boosted by recent use
//! so the last played games come first on an empty query.

use serde::{Deserialize, Serialize};

/// Who contributes an item.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provider {
    Games,
    Apps,
    Settings,
    Actions,
    Media,
    Plugin(String),
}

impl Provider {
    /// Query prefix that restricts the search to this provider.
    pub fn prefix(&self) -> Option<&'static str> {
        match self {
            Self::Games => Some("g "),
            Self::Apps => Some("a "),
            Self::Settings => Some("s "),
            Self::Actions => Some("> "),
            Self::Media => Some("m "),
            Self::Plugin(_) => None,
        }
    }
}

/// One searchable entry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub id: String,
    pub provider: Provider,
    /// Already localized title (game titles are data, settings titles are resolved by the host).
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    /// Material Symbols name.
    pub icon: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    /// Platform command run on accept (`library.play:<key>`, `settings.open:<page>`).
    pub command: String,
}

/// A ranked result.
#[derive(Clone, Debug, PartialEq)]
pub struct Hit<'a> {
    pub item: &'a SearchItem,
    pub score: i32,
}

/// The search index of the session.
#[derive(Clone, Debug, Default)]
#[cfg_attr(feature = "bevy", derive(bevy_ecs::resource::Resource))]
pub struct Launcher {
    items: Vec<SearchItem>,
    /// Item ids, most recent first.
    recent: Vec<String>,
}

const RECENT: usize = 32;

fn fold(s: &str) -> String {
    s.chars().flat_map(char::to_lowercase).collect()
}

/// Subsequence score of `query` in `text`: prefix > word start > inner match; `None` if absent.
fn score(query: &str, text: &str) -> Option<i32> {
    if query.is_empty() {
        return Some(0);
    }
    let text = fold(text);
    if text.starts_with(query) {
        return Some(1000 - text.len() as i32);
    }
    if let Some(at) = text.find(query) {
        let word_start = at == 0 || !text[..at].chars().last().is_some_and(char::is_alphanumeric);
        return Some(if word_start { 800 } else { 600 } - at as i32);
    }
    let mut chars = text.chars();
    let mut gaps = 0;
    for q in query.chars() {
        let mut found = false;
        for c in chars.by_ref() {
            if c == q {
                found = true;
                break;
            }
            gaps += 1;
        }
        if !found {
            return None;
        }
    }
    Some(400 - gaps)
}

impl Launcher {
    /// Replace one provider's items (library rescans, plugin reloads, locale changes).
    pub fn set_provider(
        &mut self,
        provider: &Provider,
        items: impl IntoIterator<Item = SearchItem>,
    ) {
        self.items.retain(|i| &i.provider != provider);
        self.items.extend(items);
    }

    /// Record a launch (boosts the item on later searches).
    pub fn used(&mut self, id: &str) {
        self.recent.retain(|r| r != id);
        self.recent.insert(0, id.to_string());
        self.recent.truncate(RECENT);
    }

    /// Ranked results for `query` (an empty query lists recent items first).
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit<'_>> {
        let mut query = query.trim_start();
        let mut only: Option<Provider> = None;
        for provider in [
            Provider::Games,
            Provider::Apps,
            Provider::Settings,
            Provider::Actions,
            Provider::Media,
        ] {
            if let Some(prefix) = provider.prefix()
                && query.starts_with(prefix)
            {
                query = &query[prefix.len()..];
                only = Some(provider);
                break;
            }
        }
        let query = fold(query.trim());
        let mut hits: Vec<Hit<'_>> = self
            .items
            .iter()
            .filter(|i| only.as_ref().is_none_or(|p| &i.provider == p))
            .filter_map(|item| {
                let best = std::iter::once(item.title.as_str())
                    .chain(item.keywords.iter().map(String::as_str))
                    .chain(std::iter::once(item.subtitle.as_str()))
                    .enumerate()
                    .filter_map(|(n, text)| {
                        score(&query, text).map(|s| if n == 0 { s } else { s - 100 })
                    })
                    .max()?;
                let boost = self
                    .recent
                    .iter()
                    .position(|r| r == &item.id)
                    .map_or(0, |at| 200 - (at as i32) * 5);
                Some(Hit {
                    item,
                    score: best + boost,
                })
            })
            .collect();
        if query.is_empty() {
            hits.retain(|h| self.recent.contains(&h.item.id) || only.is_some());
        }
        hits.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.item.title.cmp(&b.item.title))
        });
        hits.truncate(limit);
        hits
    }
}
