// SPDX-License-Identifier: Apache-2.0
//! Shared, transport-independent media extraction and embed resolution.
//!
//! Formerly the standalone `aphrody-web-media` crate, merged into `aphrody-web-extract` as
//! `aphrody_web_extract::media`: every consumer (`aphrody`, `aphrody-ffi`) already depends on
//! this crate, and the two extra dependencies (`async-trait`, `base64`) were already present in
//! the graph of every dependent. The public items keep their names under this module path.

mod extract;
mod hls;
mod hosts;
mod resolver;
mod streaming;
mod unpack;

pub use streaming::{AnimeEpisode, AnimeSeries, extract_streaming_players};

pub use extract::{classify_media, extract_media_candidates, extract_poster};
pub use hls::{
    is_master_playlist, is_playlist, label_from_height, parse_master_playlist, playlist_duration,
};
pub use hosts::{
    HostTraits, expiry_from_url, host_from_url, host_traits, normalize_embed_url, playback_headers,
};
pub use resolver::{
    MediaRequest, MediaResponse, MediaTransport, ResolveOptions, ResolvedMedia, resolve_embed,
    resolve_variants,
};
pub use unpack::{
    SourceLayer, SourceVia, decode_base64_payloads, is_packed, peel_layers, unescape_urls,
    unpack_packer,
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Hls,
    Dash,
    Mp4,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCandidate {
    pub url: String,
    pub kind: MediaKind,
    pub rule: String,
    pub confidence: f64,
    pub offset: usize,
    pub layer: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaVariant {
    pub url: String,
    pub bandwidth: Option<u64>,
    pub average_bandwidth: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codecs: Option<String>,
    pub frame_rate: Option<f64>,
    pub name: Option<String>,
    pub label: Option<String>,
}

pub(crate) fn absolute(raw: &str, base: &str) -> Option<String> {
    let base = url::Url::parse(base).ok()?;
    let joined = base.join(raw).ok()?;
    matches!(joined.scheme(), "http" | "https").then(|| joined.to_string())
}
