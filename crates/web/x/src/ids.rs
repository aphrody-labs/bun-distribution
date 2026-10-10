// SPDX-License-Identifier: Apache-2.0
//! Identifier extraction shared by the CLI and the operation table: every command that takes a
//! tweet, list or community accepts either the numeric id or its URL.

fn all_digits(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| c.is_ascii_digit())
}

fn id_after(text: &str, markers: &[&str]) -> Option<String> {
    for marker in markers {
        if let Some(rest) = text.split(marker).nth(1) {
            let id: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    None
}

/// A numeric tweet id from an id or a status URL (`.../status/<id>`, `.../statuses/<id>`, query and
/// fragment ignored).
pub fn tweet_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if all_digits(trimmed) {
        return Some(trimmed.to_owned());
    }
    id_after(trimmed, &["/status/", "/statuses/"])
}

/// A numeric list id from an id or a list URL (`.../lists/<id>`).
pub fn list_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if all_digits(trimmed) {
        return Some(trimmed.to_owned());
    }
    id_after(trimmed, &["/lists/"])
}

/// A numeric community id from an id or a community URL (`.../communities/<id>`).
pub fn community_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if all_digits(trimmed) {
        return Some(trimmed.to_owned());
    }
    id_after(trimmed, &["/communities/"])
}

/// A handle without its leading `@` and surrounding whitespace.
pub fn handle(input: &str) -> &str {
    input.trim().trim_start_matches('@')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tweet_ids_come_from_ids_and_urls() {
        assert_eq!(tweet_id("1900000000000000001").as_deref(), Some("1900000000000000001"));
        assert_eq!(tweet_id(" 42 ").as_deref(), Some("42"));
        assert_eq!(tweet_id("https://x.com/aphrody_code/status/123?s=20").as_deref(), Some("123"));
        assert_eq!(tweet_id("https://x.com/i/web/statuses/77#frag").as_deref(), Some("77"));
        assert_eq!(tweet_id("https://x.com/aphrody_code"), None);
        assert_eq!(tweet_id(""), None);
        assert_eq!(tweet_id("12ab"), None);
    }

    #[test]
    fn list_and_community_ids_come_from_ids_and_urls() {
        assert_eq!(list_id("https://x.com/i/lists/99").as_deref(), Some("99"));
        assert_eq!(list_id("99").as_deref(), Some("99"));
        assert_eq!(community_id("https://x.com/i/communities/5?x=1").as_deref(), Some("5"));
        assert_eq!(community_id("nope"), None);
    }

    #[test]
    fn handles_lose_the_at_sign() {
        assert_eq!(handle(" @aphrody_code "), "aphrody_code");
        assert_eq!(handle("aphrody_code"), "aphrody_code");
    }
}
