// SPDX-License-Identifier: Apache-2.0
//! Typed extraction of tweets and users from X's GraphQL timeline trees.
//!
//! X's GraphQL responses are deeply nested and vary per operation
//! (`HomeTimeline`, `SearchTimeline`, `UserTweets`, `TweetDetail`,
//! `Bookmarks`, …). Rather than special-case each shape, this module walks the
//! response recursively, locating every `instructions` array and pulling out
//! `tweet_results` / `user_results` entries plus the bottom pagination cursor.
//! This keeps a single, robust parser working across all timeline operations
//! and survives minor shape changes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::{
    OffsetDateTime,
    format_description::well_known::{Rfc2822, Rfc3339},
    macros::format_description,
};

/// A tweet author (the two fields the UI surfaces).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Author {
    /// Handle without the leading `@`.
    #[serde(default)]
    pub username: String,
    /// Display name.
    #[serde(default)]
    pub name: String,
}

/// One media attachment of a tweet (photo, video or animated GIF).
///
/// `url` is the best playable or viewable address: the highest-bitrate MP4 for a video or GIF,
/// the HTTPS image URL otherwise; `preview_url` is always the still image.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Media {
    /// Media id (`id_str`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// `photo`, `video` or `animated_gif`.
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Best address (video variant when present, else the preview).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Still image address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
    /// Highest-bitrate `video/mp4` variant, for videos and GIFs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_url: Option<String>,
    /// Original width in pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u64>,
    /// Original height in pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
    /// Link shown in the tweet text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expanded_url: Option<String>,
}

/// A fully-parsed tweet, mirroring the reference client's JSON schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tweet {
    /// Numeric tweet REST id.
    pub id: String,
    /// Full text (note/article body when present, else `legacy.full_text`).
    pub text: String,
    /// Author handle + display name.
    pub author: Author,
    /// Author numeric id, if resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    /// Creation timestamp (X's `created_at` string form).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Reply count.
    #[serde(default)]
    pub reply_count: u64,
    /// Retweet count.
    #[serde(default)]
    pub retweet_count: u64,
    /// Like (favorite) count.
    #[serde(default)]
    pub like_count: u64,
    /// Quote count.
    #[serde(default)]
    pub quote_count: u64,
    /// View count (impressions), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count: Option<u64>,
    /// Conversation (thread root) id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// Parent tweet id when this is a reply.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_reply_to_status_id: Option<String>,
    /// BCP-47 language code, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// Whether this carries long-form note-tweet content.
    #[serde(default)]
    pub is_note_tweet: bool,
    /// Embedded quoted tweet (depth-limited during extraction).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quoted_tweet: Option<Box<Tweet>>,
    /// Attached media (empty for a text-only tweet).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<Media>,
}

/// A parsed user (for follower/following/list-member timelines).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    /// Numeric user id.
    pub id: String,
    /// Handle without `@`.
    pub username: String,
    /// Display name.
    pub name: String,
    /// Bio / description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Followers count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followers_count: Option<u64>,
    /// Following count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub following_count: Option<u64>,
    /// Blue (paid) verification flag.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_blue_verified: Option<bool>,
    /// Profile image URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_image_url: Option<String>,
    /// Account creation timestamp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A page of tweets plus the cursor needed to fetch the next page.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TweetPage {
    /// Tweets in document order.
    pub tweets: Vec<Tweet>,
    /// Bottom cursor to pass as `cursor` for the next page, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// A page of users plus the next cursor.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserPage {
    /// Users in document order.
    pub users: Vec<User>,
    /// Bottom cursor for the next page, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Maximum quoted-tweet nesting depth to follow (mirrors `--quote-depth`).
const DEFAULT_QUOTE_DEPTH: u32 = 1;

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/// Parse a tweet or account timestamp to unix seconds.
///
/// X writes `created_at` as `Wed May 22 10:00:00 +0000 2026` (weekday and month first, the year
/// last: not RFC 2822). RFC 3339 (`2026-06-01T00:00:00Z`) and RFC 2822 are accepted too, because
/// archives and other tools use them. The weekday of the X form is ignored (the date decides).
/// Returns `None` when no form matches.
pub fn parse_timestamp(text: &str) -> Option<i64> {
    let text = text.trim();
    let without_weekday = match text.split_once(' ') {
        Some((first, rest))
            if first.len() == 3 && first.chars().all(|c| c.is_ascii_alphabetic()) =>
        {
            rest.trim_start()
        },
        _ => text,
    };
    let x_format = format_description!(
        "[month repr:short] [day padding:none] [hour]:[minute]:[second] [offset_hour sign:mandatory][offset_minute] [year]"
    );
    OffsetDateTime::parse(without_weekday, &x_format)
        .or_else(|_| OffsetDateTime::parse(text, &Rfc3339))
        .or_else(|_| OffsetDateTime::parse(text, &Rfc2822))
        .ok()
        .map(OffsetDateTime::unix_timestamp)
}

// ---------------------------------------------------------------------------
// Tweet extraction
// ---------------------------------------------------------------------------

/// Unwrap a `tweet_results.result` node, handling the
/// `TweetWithVisibilityResults` wrapper that nests the real tweet under
/// `.tweet`.
fn unwrap_tweet_result(result: &Value) -> Option<&Value> {
    match result.get("__typename").and_then(Value::as_str) {
        Some("TweetWithVisibilityResults") => result.get("tweet"),
        Some("TweetTombstone") => None,
        _ => {
            if result.get("legacy").is_some() || result.get("rest_id").is_some() {
                Some(result)
            } else if result.get("tweet").is_some() {
                result.get("tweet")
            } else {
                None
            }
        },
    }
}

/// Resolve `{username, name}` from a `user_results.result` node, tolerating both
/// the legacy (`legacy.{name,screen_name}`) and current (`core.{name,screen_name}`)
/// layouts.
fn extract_author(user_result: &Value) -> Author {
    let core = user_result.get("core");
    let name = core
        .and_then(|c| c.get("name"))
        .and_then(Value::as_str)
        .or_else(|| user_result.pointer("/legacy/name").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    let username = core
        .and_then(|c| c.get("screen_name"))
        .and_then(Value::as_str)
        .or_else(|| user_result.pointer("/legacy/screen_name").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    Author { username, name }
}

/// Pull the long-form note-tweet text, if this tweet carries one.
fn extract_note_text(tweet: &Value) -> Option<String> {
    tweet
        .pointer("/note_tweet/note_tweet_results/result/text")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

/// Extract the media attachments of a tweet (`extended_entities` first, then `entities`).
fn extract_media(legacy: &Value) -> Vec<Media> {
    let entities = legacy
        .pointer("/extended_entities/media")
        .or_else(|| legacy.pointer("/entities/media"))
        .and_then(Value::as_array);
    let Some(entities) = entities else {
        return Vec::new();
    };
    entities
        .iter()
        .map(|m| {
            let text = |key: &str| m.get(key).and_then(Value::as_str).map(ToOwned::to_owned);
            let preview_url = text("media_url_https").or_else(|| text("media_url"));
            let kind = text("type");
            let video_url = if matches!(kind.as_deref(), Some("video" | "animated_gif")) {
                m.pointer("/video_info/variants")
                    .and_then(Value::as_array)
                    .and_then(|variants| {
                        // `rev` so that ties keep the first listed variant (max_by_key keeps the last).
                        variants
                            .iter()
                            .rev()
                            .filter(|v| {
                                v.get("content_type").and_then(Value::as_str) == Some("video/mp4")
                            })
                            .max_by_key(|v| v.get("bitrate").and_then(Value::as_u64).unwrap_or(0))
                    })
                    .and_then(|v| v.get("url").and_then(Value::as_str))
                    .map(ToOwned::to_owned)
            } else {
                None
            };
            Media {
                id: text("id_str"),
                kind,
                url: video_url.clone().or_else(|| preview_url.clone()),
                preview_url,
                video_url,
                width: m.pointer("/original_info/width").and_then(Value::as_u64),
                height: m.pointer("/original_info/height").and_then(Value::as_u64),
                expanded_url: text("expanded_url"),
            }
        })
        .collect()
}

fn count_u64(legacy: &Value, key: &str) -> u64 {
    legacy.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Parse a `tweet_results.result` value into a [`Tweet`].
///
/// `quote_depth` bounds recursion into quoted tweets (0 disables embedding).
pub fn parse_tweet_result(result: &Value, quote_depth: u32) -> Option<Tweet> {
    let tweet = unwrap_tweet_result(result)?;
    let legacy = tweet.get("legacy")?;

    let id = tweet
        .get("rest_id")
        .and_then(Value::as_str)
        .or_else(|| legacy.get("id_str").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    if id.is_empty() {
        return None;
    }

    let note_text = extract_note_text(tweet);
    let is_note_tweet = note_text.is_some();
    let text = note_text
        .or_else(|| legacy.get("full_text").and_then(Value::as_str).map(ToOwned::to_owned))
        .unwrap_or_default();

    let author = tweet
        .pointer("/core/user_results/result")
        .map(extract_author)
        .unwrap_or(Author { username: String::new(), name: String::new() });

    let author_id = legacy.get("user_id_str").and_then(Value::as_str).map(ToOwned::to_owned);

    let view_count =
        tweet.pointer("/views/count").and_then(Value::as_str).and_then(|s| s.parse::<u64>().ok());

    let quoted_tweet = if quote_depth > 0 {
        tweet
            .pointer("/quoted_status_result/result")
            .and_then(|q| parse_tweet_result(q, quote_depth - 1))
            .map(Box::new)
    } else {
        None
    };

    Some(Tweet {
        id,
        text,
        author,
        author_id,
        created_at: legacy.get("created_at").and_then(Value::as_str).map(ToOwned::to_owned),
        reply_count: count_u64(legacy, "reply_count"),
        retweet_count: count_u64(legacy, "retweet_count"),
        like_count: count_u64(legacy, "favorite_count"),
        quote_count: count_u64(legacy, "quote_count"),
        view_count,
        conversation_id: legacy
            .get("conversation_id_str")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        in_reply_to_status_id: legacy
            .get("in_reply_to_status_id_str")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        lang: legacy.get("lang").and_then(Value::as_str).map(ToOwned::to_owned),
        is_note_tweet,
        quoted_tweet,
        media: extract_media(legacy),
    })
}

// ---------------------------------------------------------------------------
// Timeline walking
// ---------------------------------------------------------------------------

/// Recursively collect every `instructions` array found anywhere in `root`.
fn find_instruction_arrays<'a>(root: &'a Value, out: &mut Vec<&'a Value>) {
    match root {
        Value::Object(map) => {
            for (k, v) in map {
                if k == "instructions"
                    && let Some(arr) = v.as_array()
                {
                    out.push(v);
                    let _ = arr;
                }
                find_instruction_arrays(v, out);
            }
        },
        Value::Array(arr) => {
            for v in arr {
                find_instruction_arrays(v, out);
            }
        },
        _ => {},
    }
}

/// Walk a single entry's content, pushing any tweet(s) and noting cursors.
fn walk_entry_content(
    content: &Value,
    quote_depth: u32,
    tweets: &mut Vec<Tweet>,
    bottom: &mut Option<String>,
) {
    let entry_type = content
        .get("entryType")
        .or_else(|| content.get("__typename"))
        .and_then(Value::as_str)
        .unwrap_or("");

    match entry_type {
        "TimelineTimelineItem" => {
            if let Some(result) = content.pointer("/itemContent/tweet_results/result")
                && let Some(t) = parse_tweet_result(result, quote_depth)
            {
                tweets.push(t);
            }
        },
        "TimelineTimelineCursor" => {
            let cursor_type = content.get("cursorType").and_then(Value::as_str).unwrap_or("");
            if cursor_type == "Bottom"
                && let Some(v) = content.get("value").and_then(Value::as_str)
            {
                *bottom = Some(v.to_owned());
            }
        },
        "TimelineTimelineModule" => {
            // Conversation modules: items[].item.itemContent
            if let Some(items) = content.get("items").and_then(Value::as_array) {
                for item in items {
                    if let Some(ic) = item.pointer("/item/itemContent") {
                        // itemContent may hold a tweet or a cursor.
                        if let Some(result) = ic.pointer("/tweet_results/result")
                            && let Some(t) = parse_tweet_result(result, quote_depth)
                        {
                            tweets.push(t);
                        }
                        if ic.get("cursorType").and_then(Value::as_str) == Some("Bottom")
                            && let Some(v) = ic.get("value").and_then(Value::as_str)
                        {
                            *bottom = Some(v.to_owned());
                        }
                    }
                }
            }
        },
        _ => {},
    }
}

/// Extract all tweets and the bottom cursor from any timeline-shaped response.
pub fn walk_timeline_tweets(root: &Value, quote_depth: u32) -> TweetPage {
    let mut instruction_sets = Vec::new();
    find_instruction_arrays(root, &mut instruction_sets);

    let mut tweets = Vec::new();
    let mut bottom: Option<String> = None;

    for instructions in instruction_sets {
        let Some(arr) = instructions.as_array() else {
            continue;
        };
        for instruction in arr {
            // TimelineAddEntries / TimelineAddToModule etc.
            if let Some(entries) = instruction.get("entries").and_then(Value::as_array) {
                for entry in entries {
                    if let Some(content) = entry.get("content") {
                        walk_entry_content(content, quote_depth, &mut tweets, &mut bottom);
                    }
                }
            }
            // TimelineReplaceEntry / pin etc. carry a single `entry`.
            if let Some(entry) = instruction.get("entry")
                && let Some(content) = entry.get("content")
            {
                walk_entry_content(content, quote_depth, &mut tweets, &mut bottom);
            }
        }
    }

    TweetPage { tweets, next_cursor: bottom }
}

/// Extract all users and the bottom cursor from a user-list timeline.
pub fn walk_timeline_users(root: &Value) -> UserPage {
    let mut instruction_sets = Vec::new();
    find_instruction_arrays(root, &mut instruction_sets);

    let mut users = Vec::new();
    let mut bottom: Option<String> = None;

    for instructions in instruction_sets {
        let Some(arr) = instructions.as_array() else {
            continue;
        };
        for instruction in arr {
            let Some(entries) = instruction.get("entries").and_then(Value::as_array) else {
                continue;
            };
            for entry in entries {
                let content = entry.get("content");
                let entry_type =
                    content.and_then(|c| c.get("entryType")).and_then(Value::as_str).unwrap_or("");
                if entry_type == "TimelineTimelineCursor" {
                    if content.and_then(|c| c.get("cursorType")).and_then(Value::as_str)
                        == Some("Bottom")
                        && let Some(v) =
                            content.and_then(|c| c.get("value")).and_then(Value::as_str)
                    {
                        bottom = Some(v.to_owned());
                    }
                    continue;
                }
                if let Some(result) =
                    content.and_then(|c| c.pointer("/itemContent/user_results/result"))
                    && let Some(u) = parse_user_result(result)
                {
                    users.push(u);
                }
            }
        }
    }

    UserPage { users, next_cursor: bottom }
}

/// Parse a `user_results.result` node into a [`User`].
pub fn parse_user_result(result: &Value) -> Option<User> {
    let id = result
        .get("rest_id")
        .and_then(Value::as_str)
        .or_else(|| result.pointer("/legacy/id_str").and_then(Value::as_str))?
        .to_owned();

    let author = extract_author(result);
    if author.username.is_empty() {
        return None;
    }

    let legacy = result.get("legacy");
    let description =
        legacy.and_then(|l| l.get("description")).and_then(Value::as_str).map(ToOwned::to_owned);
    let followers_count = legacy.and_then(|l| l.get("followers_count")).and_then(Value::as_u64);
    let following_count = legacy.and_then(|l| l.get("friends_count")).and_then(Value::as_u64);
    let is_blue_verified = result.get("is_blue_verified").and_then(Value::as_bool);
    let profile_image_url = legacy
        .and_then(|l| l.get("profile_image_url_https"))
        .and_then(Value::as_str)
        .or_else(|| result.pointer("/avatar/image_url").and_then(Value::as_str))
        .map(ToOwned::to_owned);
    let created_at = legacy
        .and_then(|l| l.get("created_at"))
        .and_then(Value::as_str)
        .or_else(|| result.pointer("/core/created_at").and_then(Value::as_str))
        .map(ToOwned::to_owned);

    Some(User {
        id,
        username: author.username,
        name: author.name,
        description,
        followers_count,
        following_count,
        is_blue_verified,
        profile_image_url,
        created_at,
    })
}

/// Convenience: parse a single tweet response (e.g. `TweetDetail` for one id)
/// at the default quote depth.
pub fn parse_single_tweet(root: &Value, tweet_id: &str) -> Option<Tweet> {
    let page = walk_timeline_tweets(root, DEFAULT_QUOTE_DEPTH);
    page.tweets.into_iter().find(|t| t.id == tweet_id)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sample_tweet_result() -> Value {
        json!({
            "__typename": "Tweet",
            "rest_id": "1900000000000000001",
            "core": {
                "user_results": {
                    "result": {
                        "rest_id": "2244994945",
                        "core": { "name": "Aphrody", "screen_name": "aphrody_code" }
                    }
                }
            },
            "views": { "count": "4242" },
            "legacy": {
                "full_text": "hello world",
                "favorite_count": 10,
                "retweet_count": 2,
                "reply_count": 1,
                "quote_count": 0,
                "created_at": "Wed May 22 10:00:00 +0000 2026",
                "conversation_id_str": "1900000000000000001",
                "user_id_str": "2244994945",
                "lang": "en"
            }
        })
    }

    #[test]
    fn parses_basic_tweet() {
        let t = parse_tweet_result(&sample_tweet_result(), 1).expect("must parse");
        assert_eq!(t.id, "1900000000000000001");
        assert_eq!(t.text, "hello world");
        assert_eq!(t.author.username, "aphrody_code");
        assert_eq!(t.author.name, "Aphrody");
        assert_eq!(t.like_count, 10);
        assert_eq!(t.retweet_count, 2);
        assert_eq!(t.reply_count, 1);
        assert_eq!(t.view_count, Some(4242));
        assert_eq!(t.author_id.as_deref(), Some("2244994945"));
        assert_eq!(t.lang.as_deref(), Some("en"));
        assert!(!t.is_note_tweet);
    }

    #[test]
    fn legacy_author_layout_supported() {
        let mut r = sample_tweet_result();
        // Drop the new core layout, fall back to legacy.
        r["core"]["user_results"]["result"]["core"] = Value::Null;
        r["core"]["user_results"]["result"]["legacy"] =
            json!({ "name": "Old Name", "screen_name": "old_handle" });
        let t = parse_tweet_result(&r, 1).unwrap();
        assert_eq!(t.author.username, "old_handle");
        assert_eq!(t.author.name, "Old Name");
    }

    #[test]
    fn note_tweet_text_preferred() {
        let mut r = sample_tweet_result();
        r["note_tweet"] = json!({
            "note_tweet_results": { "result": { "text": "the full long-form body" } }
        });
        let t = parse_tweet_result(&r, 1).unwrap();
        assert!(t.is_note_tweet);
        assert_eq!(t.text, "the full long-form body");
    }

    #[test]
    fn visibility_wrapper_unwrapped() {
        let inner = sample_tweet_result();
        let wrapped = json!({
            "__typename": "TweetWithVisibilityResults",
            "tweet": inner
        });
        let t = parse_tweet_result(&wrapped, 1).unwrap();
        assert_eq!(t.text, "hello world");
    }

    #[test]
    fn quote_depth_limits_recursion() {
        let mut r = sample_tweet_result();
        let mut quoted = sample_tweet_result();
        quoted["rest_id"] = json!("1900000000000000999");
        quoted["legacy"]["full_text"] = json!("the quoted one");
        r["quoted_status_result"] = json!({ "result": quoted });

        let with_quote = parse_tweet_result(&r, 1).unwrap();
        assert!(with_quote.quoted_tweet.is_some());
        assert_eq!(with_quote.quoted_tweet.unwrap().text, "the quoted one");

        let no_quote = parse_tweet_result(&r, 0).unwrap();
        assert!(no_quote.quoted_tweet.is_none());
    }

    #[test]
    fn walks_timeline_entries_and_cursor() {
        let root = json!({
            "data": { "x": { "timeline": { "instructions": [
                {
                    "type": "TimelineAddEntries",
                    "entries": [
                        {
                            "entryId": "tweet-1",
                            "content": {
                                "entryType": "TimelineTimelineItem",
                                "itemContent": { "tweet_results": { "result": sample_tweet_result() } }
                            }
                        },
                        {
                            "entryId": "cursor-bottom",
                            "content": {
                                "entryType": "TimelineTimelineCursor",
                                "cursorType": "Bottom",
                                "value": "CURSOR_ABC"
                            }
                        }
                    ]
                }
            ]}}}
        });
        let page = walk_timeline_tweets(&root, 1);
        assert_eq!(page.tweets.len(), 1);
        assert_eq!(page.tweets[0].id, "1900000000000000001");
        assert_eq!(page.next_cursor.as_deref(), Some("CURSOR_ABC"));
    }

    #[test]
    fn walks_user_timeline() {
        let root = json!({
            "data": { "user": { "result": { "timeline": { "timeline": { "instructions": [
                {
                    "type": "TimelineAddEntries",
                    "entries": [
                        {
                            "entryId": "user-1",
                            "content": {
                                "entryType": "TimelineTimelineItem",
                                "itemContent": { "user_results": { "result": {
                                    "rest_id": "2244994945",
                                    "core": { "name": "Aphrody", "screen_name": "aphrody_code" },
                                    "is_blue_verified": true,
                                    "legacy": { "followers_count": 100, "friends_count": 50, "description": "bio" }
                                } } }
                            }
                        },
                        {
                            "entryId": "cursor-bottom",
                            "content": { "entryType": "TimelineTimelineCursor", "cursorType": "Bottom", "value": "UCUR" }
                        }
                    ]
                }
            ]}}}}}
        });
        let page = walk_timeline_users(&root);
        assert_eq!(page.users.len(), 1);
        assert_eq!(page.users[0].username, "aphrody_code");
        assert_eq!(page.users[0].followers_count, Some(100));
        assert_eq!(page.users[0].is_blue_verified, Some(true));
        assert_eq!(page.next_cursor.as_deref(), Some("UCUR"));
    }

    #[test]
    fn text_only_tweet_has_no_media() {
        let t = parse_tweet_result(&sample_tweet_result(), 1).unwrap();
        assert!(t.media.is_empty());
        // An empty list is not serialised, keeping stored JSON identical to the pre-media shape.
        let value = serde_json::to_value(&t).unwrap();
        assert!(value.get("media").is_none());
    }

    #[test]
    fn extracts_photo_and_best_video_variant() {
        let mut r = sample_tweet_result();
        r["legacy"]["extended_entities"] = json!({ "media": [
            {
                "id_str": "11",
                "type": "photo",
                "media_url_https": "https://pbs.twimg.com/media/a.jpg",
                "expanded_url": "https://x.com/aphrody_code/status/1/photo/1",
                "original_info": { "width": 1200, "height": 800 }
            },
            {
                "id_str": "12",
                "type": "video",
                "media_url_https": "https://pbs.twimg.com/ext_tw_video_thumb/b.jpg",
                "video_info": { "variants": [
                    { "content_type": "application/x-mpegURL", "url": "https://video.twimg.com/b.m3u8" },
                    { "content_type": "video/mp4", "bitrate": 256000, "url": "https://video.twimg.com/low.mp4" },
                    { "content_type": "video/mp4", "bitrate": 2176000, "url": "https://video.twimg.com/high.mp4" },
                    { "content_type": "video/mp4", "bitrate": 2176000, "url": "https://video.twimg.com/tie.mp4" }
                ] }
            }
        ] });
        let t = parse_tweet_result(&r, 1).unwrap();
        assert_eq!(t.media.len(), 2);
        let photo = &t.media[0];
        assert_eq!(photo.kind.as_deref(), Some("photo"));
        assert_eq!(photo.url.as_deref(), Some("https://pbs.twimg.com/media/a.jpg"));
        assert_eq!((photo.width, photo.height), (Some(1200), Some(800)));
        assert!(photo.video_url.is_none());
        let video = &t.media[1];
        assert_eq!(video.video_url.as_deref(), Some("https://video.twimg.com/high.mp4"));
        assert_eq!(video.url, video.video_url, "a video resolves to its best variant");
        assert_eq!(
            video.preview_url.as_deref(),
            Some("https://pbs.twimg.com/ext_tw_video_thumb/b.jpg")
        );
    }

    #[test]
    fn falls_back_to_entities_media() {
        let mut r = sample_tweet_result();
        r["legacy"]["entities"] = json!({ "media": [
            { "id_str": "7", "type": "photo", "media_url": "http://pbs.twimg.com/media/c.jpg" }
        ] });
        let t = parse_tweet_result(&r, 1).unwrap();
        assert_eq!(t.media[0].preview_url.as_deref(), Some("http://pbs.twimg.com/media/c.jpg"));
    }

    #[test]
    fn parses_the_timestamp_forms_x_and_its_tools_write() {
        // 2026-05-22T10:00:00Z
        let expected = 1_779_444_000;
        assert_eq!(parse_timestamp("Fri May 22 10:00:00 +0000 2026"), Some(expected));
        assert_eq!(parse_timestamp("Fri May 22 10:00:00 +0000 2026 "), Some(expected));
        // The weekday is not trusted: fixtures and hand-written dates often get it wrong.
        assert_eq!(parse_timestamp("Wed May 22 10:00:00 +0000 2026"), Some(expected));
        assert_eq!(parse_timestamp("2026-05-22T10:00:00Z"), Some(expected));
        assert_eq!(parse_timestamp("2026-05-22T12:00:00+02:00"), Some(expected));
        assert_eq!(parse_timestamp("Fri, 22 May 2026 10:00:00 +0000"), Some(expected));
        // A single-digit day, with or without zero padding.
        assert_eq!(
            parse_timestamp("Mon Jun 3 00:00:00 +0000 2024"),
            parse_timestamp("Mon Jun 03 00:00:00 +0000 2024")
        );
        assert!(parse_timestamp("Mon Jun 3 00:00:00 +0000 2024").is_some());
        assert_eq!(parse_timestamp("not a date"), None);
        assert_eq!(parse_timestamp(""), None);
    }
}
