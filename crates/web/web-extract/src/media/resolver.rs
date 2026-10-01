// SPDX-License-Identifier: Apache-2.0
use super::{
    MediaCandidate, MediaKind, MediaVariant, absolute, classify_media, expiry_from_url,
    extract_media_candidates, extract_poster, host_from_url, host_traits, is_master_playlist,
    normalize_embed_url, parse_master_playlist, playback_headers,
};
use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRequest {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub referer: Option<String>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

impl MediaRequest {
    pub fn get(url: impl Into<String>, referer: Option<&str>, timeout_ms: Option<u64>) -> Self {
        Self {
            url: url.into(),
            method: "GET".to_string(),
            headers: BTreeMap::new(),
            referer: referer.map(str::to_string),
            body: None,
            timeout_ms,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MediaResponse {
    pub status: u16,
    pub body: String,
    pub url: Option<String>,
}

#[async_trait]
pub trait MediaTransport: Send + Sync {
    async fn fetch(&self, request: MediaRequest) -> Result<MediaResponse, String>;
}

pub struct ResolveOptions<'a> {
    pub transport: &'a dyn MediaTransport,
    pub referer: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub enumerate_variants: bool,
    pub timeout_ms: Option<u64>,
    pub max_hops: usize,
}

impl<'a> ResolveOptions<'a> {
    pub fn new(transport: &'a dyn MediaTransport) -> Self {
        Self {
            transport,
            referer: None,
            user_agent: None,
            enumerate_variants: false,
            timeout_ms: None,
            max_hops: 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMedia {
    pub host: String,
    pub embed_url: String,
    pub kind: MediaKind,
    pub url: Option<String>,
    pub candidates: Vec<MediaCandidate>,
    pub variants: Vec<MediaVariant>,
    pub headers: BTreeMap<String, String>,
    pub poster: Option<String>,
    pub expires_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn next_hop(body: &str, current_url: &str) -> Option<String> {
    let regex = Regex::new(r#"(?i)<iframe[^>]+src\s*=\s*['"]([^'"]+)['"]"#).ok()?;
    regex.captures_iter(body).find_map(|caps| {
        let url = absolute(&caps[1], current_url)?;
        (url != current_url).then_some(url)
    })
}

async fn resolve_mailru(
    body: &str,
    current_url: &str,
    opts: &ResolveOptions<'_>,
) -> Vec<MediaCandidate> {
    let explicit = Regex::new(r#"['"]metadataUrl['"]\s*:\s*['"]([^'"]+)['"]"#)
        .ok()
        .and_then(|regex| regex.captures(body).map(|caps| caps[1].replace("\\/", "/")));
    let embed_id = Regex::new(r"/video/embed/(\d+)")
        .ok()
        .and_then(|regex| regex.captures(current_url).map(|caps| caps[1].to_string()));
    let candidate = explicit.or_else(|| embed_id.map(|id| format!("/+/video/meta/{id}")));
    let Some(metadata_url) = candidate.and_then(|url| absolute(&url, current_url)) else {
        return Vec::new();
    };
    let mut request = MediaRequest::get(&metadata_url, Some(current_url), opts.timeout_ms);
    if let Some(user_agent) = opts.user_agent {
        request.headers.insert("User-Agent".to_string(), user_agent.to_string());
    }
    let Ok(response) = opts.transport.fetch(request).await else { return Vec::new() };
    if response.status >= 400 {
        return Vec::new();
    }
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&response.body) else {
        return Vec::new();
    };
    let Some(videos) = payload.get("videos").and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let mut candidates: Vec<_> = videos
        .iter()
        .filter_map(|video| {
            let url = absolute(video.get("url")?.as_str()?, &metadata_url)?;
            Some(MediaCandidate {
                kind: classify_media(&url),
                url,
                rule: "mailru.metadata".to_string(),
                confidence: 1.0,
                offset: 0,
                layer: 0,
                label: video.get("key").and_then(serde_json::Value::as_str).map(str::to_string),
            })
        })
        .collect();
    candidates.sort_by(|a, b| {
        let quality = |candidate: &MediaCandidate| {
            candidate
                .label
                .as_deref()
                .unwrap_or("0")
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<u32>()
                .unwrap_or(0)
        };
        quality(b).cmp(&quality(a))
    });
    candidates
}

pub async fn resolve_variants(playlist_url: &str, opts: &ResolveOptions<'_>) -> Vec<MediaVariant> {
    let mut request = MediaRequest::get(playlist_url, opts.referer, opts.timeout_ms);
    request.headers = playback_headers(playlist_url, opts.user_agent);
    let Ok(response) = opts.transport.fetch(request).await else { return Vec::new() };
    if response.status >= 400 || !is_master_playlist(&response.body) {
        return Vec::new();
    }
    parse_master_playlist(&response.body, response.url.as_deref().unwrap_or(playlist_url))
}

pub async fn resolve_embed(embed_url: &str, opts: &ResolveOptions<'_>) -> ResolvedMedia {
    let normalized = normalize_embed_url(embed_url);
    let traits = host_traits(&normalized);
    let mut resolved = ResolvedMedia {
        host: host_from_url(&normalized),
        embed_url: normalized.clone(),
        kind: MediaKind::Unknown,
        url: None,
        candidates: Vec::new(),
        variants: Vec::new(),
        headers: playback_headers(&normalized, opts.user_agent),
        poster: None,
        expires_at: None,
        error: None,
    };
    if traits.proprietary {
        resolved.error = Some(format!(
            "{} is a proprietary player requiring a dedicated extractor",
            resolved.host
        ));
        return resolved;
    }
    let mut current_url = normalized.clone();
    for hop in 0..=opts.max_hops.min(8) {
        let referer = if hop == 0 { opts.referer } else { Some(normalized.as_str()) };
        let mut request = MediaRequest::get(&current_url, referer, opts.timeout_ms);
        if let Some(user_agent) = opts.user_agent {
            request.headers.insert("User-Agent".to_string(), user_agent.to_string());
        }
        let response = match opts.transport.fetch(request).await {
            Ok(response) => response,
            Err(error) => {
                resolved.error = Some(format!("embed page unreachable: {error}"));
                return resolved;
            },
        };
        if response.status >= 400 {
            resolved.error = Some(format!("embed returned {}", response.status));
            return resolved;
        }
        let final_url = response.url.as_deref().unwrap_or(&current_url);
        let mut candidates = extract_media_candidates(&response.body, final_url);
        if candidates.is_empty() && traits.name == "mailru" {
            candidates = resolve_mailru(&response.body, final_url, opts).await;
        }
        resolved.poster = resolved.poster.or_else(|| extract_poster(&response.body, final_url));
        if let Some(best) = candidates.first().cloned() {
            resolved.host = host_from_url(final_url);
            resolved.embed_url = final_url.to_string();
            resolved.kind = best.kind;
            resolved.url = Some(best.url.clone());
            resolved.expires_at = expiry_from_url(&best.url);
            resolved.headers = playback_headers(final_url, opts.user_agent);
            resolved.candidates = candidates;
            if opts.enumerate_variants && best.kind == MediaKind::Hls {
                let playlist_opts = ResolveOptions {
                    transport: opts.transport,
                    referer: Some(final_url),
                    user_agent: opts.user_agent,
                    enumerate_variants: false,
                    timeout_ms: opts.timeout_ms,
                    max_hops: opts.max_hops,
                };
                resolved.variants = resolve_variants(&best.url, &playlist_opts).await;
            }
            return resolved;
        }
        let Some(next) =
            (hop < opts.max_hops).then(|| next_hop(&response.body, final_url)).flatten()
        else {
            break;
        };
        current_url = next;
        resolved.embed_url = current_url.clone();
    }
    resolved.error = Some(if traits.obfuscated {
        format!("{} masks its source; static extraction requires page execution", resolved.host)
    } else {
        "no media candidate found in embed page".to_string()
    });
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Fake {
        pages: HashMap<String, MediaResponse>,
    }
    #[async_trait]
    impl MediaTransport for Fake {
        async fn fetch(&self, request: MediaRequest) -> Result<MediaResponse, String> {
            self.pages.get(&request.url).cloned().ok_or_else(|| "missing fixture".to_string())
        }
    }

    #[tokio::test]
    async fn follows_iframe_and_enumerates_hls() {
        let pages = HashMap::from([
            (
                "https://embed.test/e".to_string(),
                MediaResponse {
                    status: 200,
                    body: r#"<iframe src="https://video.sibnet.ru/player"></iframe>"#.to_string(),
                    url: None,
                },
            ),
            (
                "https://video.sibnet.ru/player".to_string(),
                MediaResponse {
                    status: 200,
                    body: r#"setup({sources:[{file:"https://cdn.test/master.m3u8",label:"HD"}]})"#
                        .to_string(),
                    url: None,
                },
            ),
            (
                "https://cdn.test/master.m3u8".to_string(),
                MediaResponse {
                    status: 200,
                    body:
                        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720.m3u8"
                            .to_string(),
                    url: None,
                },
            ),
        ]);
        let fake = Fake { pages };
        let mut opts = ResolveOptions::new(&fake);
        opts.enumerate_variants = true;
        let media = resolve_embed("https://embed.test/e", &opts).await;
        assert_eq!(media.host, "sibnet");
        assert_eq!(media.kind, MediaKind::Hls);
        assert_eq!(media.variants[0].label.as_deref(), Some("720p"));
        assert_eq!(media.headers["Referer"], "https://video.sibnet.ru/");
    }

    #[tokio::test]
    async fn proprietary_player_skips_transport() {
        let fake = Fake { pages: HashMap::new() };
        let media =
            resolve_embed("https://www.youtube.com/embed/x", &ResolveOptions::new(&fake)).await;
        assert_eq!(media.host, "youtube");
        assert!(media.error.is_some());
    }

    #[tokio::test]
    async fn mailru_metadata_orders_qualities() {
        let embed = "https://my.mail.ru/video/embed/123";
        let metadata = "https://my.mail.ru/+/video/meta/123";
        let pages = HashMap::from([
            (embed.to_string(), MediaResponse {
                status: 200,
                body: r#"<script>window.player={"metadataUrl":"/+/video/meta/123"}</script>"#.to_string(),
                url: None,
            }),
            (metadata.to_string(), MediaResponse {
                status: 200,
                body: r#"{"videos":[{"key":"360p","url":"//cdn.mail.ru/low.mp4"},{"key":"1080p","url":"//cdn.mail.ru/high.mp4"}]}"#.to_string(),
                url: None,
            }),
        ]);
        let fake = Fake { pages };
        let media = resolve_embed(embed, &ResolveOptions::new(&fake)).await;
        assert_eq!(media.host, "mailru");
        assert_eq!(media.url.as_deref(), Some("https://cdn.mail.ru/high.mp4"));
        assert_eq!(media.candidates[0].label.as_deref(), Some("1080p"));
        assert_eq!(media.candidates[0].rule, "mailru.metadata");
    }

    #[tokio::test]
    async fn failed_variant_request_keeps_media() {
        let fake = Fake {
            pages: HashMap::from([(
                "https://embed.test/e".to_string(),
                MediaResponse {
                    status: 200,
                    body: r#"setup({sources:[{file:"https://cdn.test/missing.m3u8"}]})"#
                        .to_string(),
                    url: None,
                },
            )]),
        };
        let mut opts = ResolveOptions::new(&fake);
        opts.enumerate_variants = true;
        let media = resolve_embed("https://embed.test/e", &opts).await;
        assert_eq!(media.url.as_deref(), Some("https://cdn.test/missing.m3u8"));
        assert!(media.variants.is_empty());
    }
}
