// SPDX-License-Identifier: Apache-2.0
//! Product-neutral orchestration for local and remote frame search.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{
    descriptor::{ColorLayoutVector, encode_color_layout},
    error::{FramesError, Result},
    index::{FramesIndex, FramesStats, MediaRow, SceneMatch, SearchOptions, default_index_path},
    media::extract_vector,
    trace_moe::{Quota, TraceMatch, TraceMoeClient},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramesVectorOutput {
    pub hash: String,
    pub vector: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum FramesSearchMode {
    Local,
    Remote,
    #[default]
    Auto,
}

#[derive(Debug, Clone, Default)]
pub struct FramesSearchOptions {
    pub mode: FramesSearchMode,
    pub limit: Option<usize>,
    pub anilist_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramesSearchOutput {
    pub origin: String,
    pub matches: Vec<FramesSearchMatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<Quota>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramesSearchMatch {
    pub title: String,
    pub episode: serde_json::Value,
    pub season: Option<i64>,
    pub from_ms: i64,
    pub at_ms: i64,
    pub to_ms: i64,
    pub similarity: f64,
    pub source: String,
    pub anilist: i64,
    pub preview: FramePreview,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FramePreview {
    pub image: String,
    pub video: String,
}

impl From<SceneMatch> for FramesSearchMatch {
    fn from(item: SceneMatch) -> Self {
        Self {
            title: item.title,
            episode: item.episode.map_or(serde_json::Value::Null, serde_json::Value::from),
            season: item.season,
            from_ms: item.from_ms,
            at_ms: item.at_ms,
            to_ms: item.to_ms,
            similarity: item.similarity,
            source: item.source,
            anilist: 0,
            preview: FramePreview::default(),
        }
    }
}
impl From<TraceMatch> for FramesSearchMatch {
    fn from(item: TraceMatch) -> Self {
        let title = item
            .anilist
            .get("title")
            .and_then(|value| {
                value.get("romaji").or_else(|| value.get("english")).or_else(|| value.get("native"))
            })
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&item.filename)
            .to_owned();
        let anilist =
            item.anilist.get("id").and_then(serde_json::Value::as_i64).unwrap_or_default();
        Self {
            title,
            episode: item.episode,
            season: None,
            from_ms: (item.from * 1000.0).round() as i64,
            at_ms: (item.from * 1000.0).round() as i64,
            to_ms: (item.to * 1000.0).round() as i64,
            similarity: item.similarity,
            source: item.filename,
            anilist,
            preview: FramePreview { image: item.image, video: item.video },
        }
    }
}

/// Reusable interface used by CLI, MCP and language bindings.
pub struct FramesClient {
    index_path: PathBuf,
    remote: TraceMoeClient,
}

impl FramesClient {
    pub fn new() -> Result<Self> {
        Self::with_index_path(default_index_path())
    }
    pub fn with_index_path(path: impl Into<PathBuf>) -> Result<Self> {
        Ok(Self { index_path: path.into(), remote: TraceMoeClient::new()? })
    }
    pub fn with_remote(path: impl Into<PathBuf>, remote: TraceMoeClient) -> Self {
        Self { index_path: path.into(), remote }
    }
    pub fn index_path(&self) -> &std::path::Path {
        &self.index_path
    }

    pub fn vector_file(
        &self,
        path: impl AsRef<std::path::Path>,
        at_ms: Option<u64>,
    ) -> Result<FramesVectorOutput> {
        let vector = extract_vector(path, at_ms)?;
        Ok(FramesVectorOutput { hash: encode_color_layout(&vector)?, vector: vector.to_vec() })
    }

    pub fn stats(&self) -> Result<FramesStats> {
        FramesIndex::open(&self.index_path)?.stats()
    }
    pub fn list(&self, filter: Option<&str>) -> Result<Vec<MediaRow>> {
        FramesIndex::open(&self.index_path)?.list(filter)
    }
    pub fn index(
        &self,
        video: impl AsRef<std::path::Path>,
        meta: crate::index::MediaMeta,
        fps: f64,
        force: bool,
    ) -> Result<usize> {
        let mut index = FramesIndex::open(&self.index_path)?;
        crate::media::index_video(&mut index, video, meta, fps, force)
    }

    pub async fn search_file(
        &self,
        path: impl AsRef<std::path::Path>,
        at_ms: Option<u64>,
        options: FramesSearchOptions,
    ) -> Result<FramesSearchOutput> {
        let vector = extract_vector(path, at_ms)?;
        self.search_vector(&vector, options).await
    }

    pub async fn search_vector(
        &self,
        vector: &ColorLayoutVector,
        options: FramesSearchOptions,
    ) -> Result<FramesSearchOutput> {
        let local = if options.mode != FramesSearchMode::Remote {
            let index = FramesIndex::open(&self.index_path)?;
            index.search(
                vector,
                SearchOptions { limit: options.limit, ..SearchOptions::default() },
            )?
        } else {
            Vec::new()
        };
        let local_matches: Vec<_> = local.into_iter().map(FramesSearchMatch::from).collect();
        if options.mode == FramesSearchMode::Local
            || (options.mode == FramesSearchMode::Auto
                && local_matches.first().is_some_and(|hit| hit.similarity >= 0.90))
        {
            return Ok(FramesSearchOutput {
                origin: "local".into(),
                matches: local_matches,
                quota: None,
            });
        }
        let remote = self.remote.search_by_vector(vector, options.anilist_id).await?;
        let matches: Vec<_> = remote
            .into_iter()
            .take(options.limit.unwrap_or(5).clamp(1, 100))
            .map(FramesSearchMatch::from)
            .collect();
        Ok(FramesSearchOutput { origin: "trace.moe".into(), matches, quota: None })
    }

    pub async fn quota(&self) -> Result<Quota> {
        self.remote.quota().await
    }
}

pub fn vector_from_bytes(bytes: &[u8]) -> Result<ColorLayoutVector> {
    bytes
        .try_into()
        .map_err(|_| FramesError::InvalidVector("descriptor must contain 33 bytes".into()))
}

/// Parses a seconds value or an HH:MM:SS[.mmm] timecode into milliseconds.
pub fn parse_timecode(value: &str) -> Result<u64> {
    let input = value.trim();
    if input.is_empty() {
        return Err(FramesError::InvalidRequest("timecode is empty".into()));
    }
    let seconds = if input.contains(':') {
        let parts: Vec<_> = input.split(':').collect();
        if !(2..=3).contains(&parts.len()) {
            return Err(FramesError::InvalidRequest(format!("invalid timecode {input:?}")));
        }
        let mut total = 0.0;
        for (index, part) in parts.iter().enumerate() {
            let number: f64 = part
                .parse()
                .map_err(|_| FramesError::InvalidRequest(format!("invalid timecode {input:?}")))?;
            let last = index + 1 == parts.len();
            if !number.is_finite()
                || number < 0.0
                || (!last && (number.fract() != 0.0 || number >= 60.0))
            {
                return Err(FramesError::InvalidRequest(format!("invalid timecode {input:?}")));
            }
            total = total * 60.0 + number;
        }
        total
    } else {
        input
            .parse::<f64>()
            .map_err(|_| FramesError::InvalidRequest(format!("invalid seconds value {input:?}")))?
    };
    if !seconds.is_finite() || seconds < 0.0 || seconds > (u64::MAX / 1000) as f64 {
        return Err(FramesError::InvalidRequest(format!(
            "timecode {input:?} is outside supported range"
        )));
    }
    Ok((seconds * 1000.0).round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_human_timecodes_and_seconds() {
        assert_eq!(parse_timecode("01:02:03.500").unwrap(), 3_723_500);
        assert_eq!(parse_timecode("02:03").unwrap(), 123_000);
        assert_eq!(parse_timecode("1.25").unwrap(), 1_250);
        assert!(parse_timecode("01:72:00").is_err());
    }
}
