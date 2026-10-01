// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Direct integration with the Aphrody Web & Dragon Ball FR manga & databooks catalog and CDN.
//!
//! Fetches exact encoded manga/databook image bytes for Koharu processing.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

use crate::pipeline::{MangaPageResult, MangaPipeline, MangaPipelineError, MangaPipelineOptions};

/// Errors encountered while fetching or streaming from the manga/databook CDN.
#[derive(Debug, Error)]
pub enum CdnError {
    /// HTTP network error.
    #[cfg(not(target_arch = "wasm32"))]
    #[error("HTTP network error: {0}")]
    Network(#[from] reqwest::Error),

    /// Requested resource was not found on the catalog.
    #[error("resource not found: {0}")]
    NotFound(String),

    /// Missing or malformed data in API response.
    #[error("invalid API response: {0}")]
    InvalidResponse(String),

    /// Pipeline or export failure.
    #[error("manga processing error: {0}")]
    Pipeline(#[from] MangaPipelineError),

    /// General I/O error.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Metadata describing a fetched manga or databook plate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlateRecord {
    /// Associated entity or databook ID.
    pub entity_id: u64,
    /// Plate number within the volume or chapter.
    pub plate_number: u32,
    /// Absolute CDN media URL.
    pub cdn_url: String,
    /// Pre-existing transcription text if available on the catalog.
    pub existing_text: Option<String>,
}

/// Client for streaming manga plates and databook scans directly from the CDN.
#[derive(Debug, Clone)]
pub struct MangaCdnClient {
    base_url: String,
    media_base_url: String,
    #[cfg(not(target_arch = "wasm32"))]
    client: reqwest::Client,
}

impl Default for MangaCdnClient {
    fn default() -> Self {
        Self::new()
    }
}

impl MangaCdnClient {
    fn require_koharu() -> Result<(), CdnError> {
        #[cfg(not(feature = "koharu"))]
        {
            Err(CdnError::Pipeline(MangaPipelineError::Unavailable))
        }
        #[cfg(feature = "koharu")]
        {
            Ok(())
        }
    }

    /// Create a new CDN client with default environment resolution.
    #[must_use]
    pub fn new() -> Self {
        let base_url = std::env::var("DBFR_BASE_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "https://dragonballfr.com".to_string());

        let media_base_url = std::env::var("DBFR_MEDIA_BASE_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| format!("{}/wiki", base_url.trim_end_matches('/')));

        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }

        #[cfg(not(target_arch = "wasm32"))]
        let client = reqwest::Client::builder()
            .user_agent("aphrody-manga/1.0.0 (Aphrody Sovereign Scanlation Engine)")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            base_url,
            media_base_url,
            #[cfg(not(target_arch = "wasm32"))]
            client,
        }
    }

    /// Resolves any relative media path or asset link into an absolute CDN URL.
    #[must_use]
    pub fn resolve_cdn_url(&self, raw_path: &str) -> String {
        let trimmed = raw_path.trim();
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return trimmed.to_string();
        }
        let rel = trimmed.trim_start_matches("./").trim_start_matches('/');
        let rel = rel.strip_prefix("assets/wiki/").unwrap_or(rel);
        format!("{}/{}", self.media_base_url.trim_end_matches('/'), rel)
    }

    /// Fetch exact image bytes from a CDN URL or local path.
    pub async fn fetch_image(&self, url_or_path: &str) -> Result<Vec<u8>, CdnError> {
        // If local file exists, read directly (off the executor: a plate can be many MiB).
        let local_path = Path::new(url_or_path);
        #[cfg(not(target_arch = "wasm32"))]
        {
            if tokio::fs::try_exists(local_path).await.unwrap_or(false) {
                return Ok(tokio::fs::read(local_path).await?);
            }
        }
        #[cfg(target_arch = "wasm32")]
        {
            if local_path.exists() {
                return Ok(std::fs::read(local_path)?);
            }
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let abs_url = self.resolve_cdn_url(url_or_path);
            let resp = self.client.get(&abs_url).send().await?;
            if !resp.status().is_success() {
                return Err(CdnError::NotFound(format!(
                    "CDN returned HTTP {} for {}",
                    resp.status(),
                    abs_url
                )));
            }
            Ok(resp.bytes().await?.to_vec())
        }

        #[cfg(target_arch = "wasm32")]
        {
            Err(CdnError::NotFound("Networking not supported on wasm32 target".to_string()))
        }
    }

    /// Fetch a databook plate by databook ID and plate number directly from the catalog.
    pub async fn fetch_databook_plate(
        &self,
        databook_id: u64,
        plate_number: u32,
    ) -> Result<(Vec<u8>, PlateRecord), CdnError> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let endpoint =
                format!("{}/api/databooks/{}", self.base_url.trim_end_matches('/'), databook_id);
            let resp = self.client.get(&endpoint).send().await?;
            if !resp.status().is_success() {
                return Err(CdnError::NotFound(format!(
                    "Databook {databook_id} not found: HTTP {}",
                    resp.status()
                )));
            }
            let record: serde_json::Value = resp.json().await?;
            let pages =
                record.get("pages").and_then(serde_json::Value::as_array).ok_or_else(|| {
                    CdnError::InvalidResponse(format!("Databook {databook_id} has no pages field"))
                })?;

            let target_page = pages.iter().find(|p| {
                p.get("number")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(|n| n as u32 == plate_number)
            });

            let Some(page) = target_page else {
                return Err(CdnError::NotFound(format!(
                    "Plate {plate_number} not found in Databook {databook_id}"
                )));
            };

            let stored_img =
                page.get("image").and_then(serde_json::Value::as_str).ok_or_else(|| {
                    CdnError::InvalidResponse(format!("Plate {plate_number} has no image field"))
                })?;

            let cdn_url = self.resolve_cdn_url(stored_img);
            let existing_text =
                page.get("text").and_then(serde_json::Value::as_str).map(str::to_string);

            let image = self.fetch_image(&cdn_url).await?;
            let record =
                PlateRecord { entity_id: databook_id, plate_number, cdn_url, existing_text };

            Ok((image, record))
        }

        #[cfg(target_arch = "wasm32")]
        {
            Err(CdnError::NotFound("Networking not supported on wasm32 target".to_string()))
        }
    }

    /// Fetch a plate and run Koharu's real page stages and PSD export.
    pub async fn scanlate_cdn_plate(
        &self,
        cdn_url_or_path: &str,
        options: &MangaPipelineOptions,
    ) -> Result<(MangaPageResult, Vec<u8>), CdnError> {
        Self::require_koharu()?;
        let bytes = self.fetch_image(cdn_url_or_path).await?;
        let output = MangaPipeline::process_image_bytes(&bytes, options).await?;
        let mut result = output.result;
        result.source.url = Some(self.resolve_cdn_url(cdn_url_or_path));
        Ok((
            result,
            output.psd_bytes.ok_or_else(|| {
                CdnError::InvalidResponse("Koharu did not export a PSD".to_owned())
            })?,
        ))
    }

    /// Fetch a manga plate by chapter ID and plate number directly from the catalog.
    pub async fn fetch_manga_plate(
        &self,
        chapter_id: u64,
        plate_number: u32,
    ) -> Result<(Vec<u8>, PlateRecord), CdnError> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let endpoint = format!(
                "{}/api/manga/chapter/{}/planche/{}",
                self.base_url.trim_end_matches('/'),
                chapter_id,
                plate_number
            );
            let resp = self.client.get(&endpoint).send().await?;
            if !resp.status().is_success() {
                return Err(CdnError::NotFound(format!(
                    "Manga chapter {chapter_id} plate {plate_number} not found: HTTP {}",
                    resp.status()
                )));
            }
            let record: serde_json::Value = resp.json().await?;
            let stored_img = record
                .get("image")
                .or_else(|| record.get("url"))
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    CdnError::InvalidResponse(format!(
                        "Manga plate {plate_number} has no image field"
                    ))
                })?;

            let cdn_url = self.resolve_cdn_url(stored_img);
            let existing_text = record
                .get("text")
                .or_else(|| record.get("transcription"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);

            let image = self.fetch_image(&cdn_url).await?;
            let record =
                PlateRecord { entity_id: chapter_id, plate_number, cdn_url, existing_text };

            Ok((image, record))
        }

        #[cfg(target_arch = "wasm32")]
        {
            Err(CdnError::NotFound("Networking not supported on wasm32 target".to_string()))
        }
    }

    /// Stream and scanlate a manga plate directly from the chapter/plate catalog.
    pub async fn scanlate_manga_plate(
        &self,
        chapter_id: u64,
        plate_number: u32,
        options: &MangaPipelineOptions,
    ) -> Result<(MangaPageResult, Vec<u8>, PlateRecord), CdnError> {
        Self::require_koharu()?;
        let (bytes, record) = self.fetch_manga_plate(chapter_id, plate_number).await?;
        let output = MangaPipeline::process_image_bytes(&bytes, options).await?;
        let mut result = output.result;
        result.source.kind = "manga".to_owned();
        result.source.entity_id = Some(chapter_id);
        result.source.plate_number = Some(plate_number);
        result.source.url = Some(record.cdn_url.clone());
        Ok((
            result,
            output.psd_bytes.ok_or_else(|| {
                CdnError::InvalidResponse("Koharu did not export a PSD".to_owned())
            })?,
            record,
        ))
    }

    /// Stream and scanlate a databook plate directly from the catalog.
    pub async fn scanlate_databook_plate(
        &self,
        databook_id: u64,
        plate_number: u32,
        options: &MangaPipelineOptions,
    ) -> Result<(MangaPageResult, Vec<u8>, PlateRecord), CdnError> {
        Self::require_koharu()?;
        let (bytes, record) = self.fetch_databook_plate(databook_id, plate_number).await?;
        let output = MangaPipeline::process_image_bytes(&bytes, options).await?;
        let mut result = output.result;
        result.source.kind = "databook".to_owned();
        result.source.entity_id = Some(databook_id);
        result.source.plate_number = Some(plate_number);
        result.source.url = Some(record.cdn_url.clone());
        Ok((
            result,
            output.psd_bytes.ok_or_else(|| {
                CdnError::InvalidResponse("Koharu did not export a PSD".to_owned())
            })?,
            record,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_cdn_url() {
        let client = MangaCdnClient::new();
        let abs = client.resolve_cdn_url("assets/wiki/databooks/312/0001.jpg");
        assert!(abs.starts_with("https://") || abs.starts_with("http://"));
        assert!(abs.ends_with("databooks/312/0001.jpg"));

        let already_abs = client.resolve_cdn_url("https://cdn.dragonballfr.com/img.png");
        assert_eq!(already_abs, "https://cdn.dragonballfr.com/img.png");
    }
}
