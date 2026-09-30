// SPDX-License-Identifier: Apache-2.0

use std::collections::{HashMap, HashSet};
use url::Url;

const STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "de", "des", "du", "en", "et", "for", "from",
    "in", "is", "it", "la", "le", "les", "of", "on", "or", "the", "this", "to", "un", "une",
    "with", "www", "http", "https", "html", "htm", "php", "asp", "aspx", "jsp", "index", "amp",
];

fn stem(term: &str) -> String {
    if term.len() <= 4 {
        return term.to_owned();
    }
    if let Some(root) = term.strip_suffix("ies") {
        return format!("{root}y");
    }
    if ["ss", "us", "is"].iter().any(|suffix| term.ends_with(suffix)) {
        return term.to_owned();
    }
    for suffix in ["ches", "shes", "xes", "zes", "sses"] {
        if term.ends_with(suffix) {
            return term[..term.len() - 2].to_owned();
        }
    }
    if term.len() >= 7
        && let Some(root) = term.strip_suffix("ing")
    {
        return root.to_owned();
    }
    if term.len() >= 6
        && let Some(root) = term.strip_suffix("ed")
    {
        return root.to_owned();
    }
    term.strip_suffix('s').unwrap_or(term).to_owned()
}

fn terms(text: &str) -> Vec<String> {
    let mut spaced = String::with_capacity(text.len());
    let mut previous_lower = false;
    for ch in text.chars() {
        if previous_lower && ch.is_uppercase() {
            spaced.push(' ');
        }
        spaced.extend(ch.to_lowercase());
        previous_lower = ch.is_lowercase() || ch.is_numeric();
    }
    spaced
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.chars().count() >= 2 && !STOPWORDS.contains(token))
        .map(stem)
        .collect()
}

fn shares_stem(a: &str, b: &str) -> bool {
    b.len() >= 4 && a.len().abs_diff(b.len()) <= 3 && (a.starts_with(b) || b.starts_with(a))
}

/// BM25-style anchor and URL path relevance from the source frontier.
pub fn anchor_relevance(goal: &str, anchor: Option<&str>, url: &Url) -> f64 {
    let goal_terms: HashSet<_> = terms(goal).into_iter().collect();
    if goal_terms.is_empty() {
        return 0.0;
    }
    let mut tf = HashMap::<String, f64>::new();
    let mut length = 0.0;
    if let Some(anchor) = anchor {
        for term in terms(anchor) {
            *tf.entry(term).or_default() += 1.0;
            length += 1.0;
        }
    }
    for term in terms(url.path()) {
        *tf.entry(term).or_default() += 0.5;
        length += 0.5;
    }
    if length == 0.0 {
        return 0.0;
    }
    let norm = 0.75 + 0.25 * length / 8.0;
    let mut sum = 0.0;
    for goal_term in &goal_terms {
        let mut frequency = *tf.get(goal_term).unwrap_or(&0.0);
        if frequency == 0.0 && goal_term.len() >= 4 {
            frequency = tf
                .iter()
                .filter(|(term, _)| shares_stem(goal_term, term))
                .map(|(_, count)| count)
                .sum();
        }
        if frequency > 0.0 {
            sum += (frequency * 2.2 / (frequency + 1.2 * norm)).min(1.0);
        }
    }
    (sum / goal_terms.len() as f64).clamp(0.0, 1.0)
}

/// OPIC cash + anchor relevance + depth prior + boost − family penalty.
pub fn frontier_score(cash: f64, relevance: f64, depth: u32, boost: f64, family_done: u32) -> f64 {
    let penalty = (0.25 * f64::from(family_done)).min(1.0);
    (cash + relevance + 0.5_f64.powi(depth.min(i32::MAX as u32) as i32) + boost - penalty)
        .clamp(-1e9, 1e9)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_and_path_terms_prioritize_focused_pages() {
        let url = Url::parse("https://example.test/rust/crawlers").unwrap();
        let relevant = anchor_relevance("rust crawler", Some("Rust crawling guide"), &url);
        let unrelated = anchor_relevance("gardening roses", Some("A flower bed"), &url);
        assert!(relevant > unrelated);
        assert!((0.0..=1.0).contains(&relevant));
    }

    #[test]
    fn score_rewards_cash_and_penalizes_done_family() {
        assert!(frontier_score(1.0, 0.0, 0, 0.0, 0) > frontier_score(0.0, 0.0, 3, 0.0, 0));
        assert!(frontier_score(1.0, 0.0, 0, 0.0, 0) > frontier_score(1.0, 0.0, 0, 0.0, 2));
    }
}
