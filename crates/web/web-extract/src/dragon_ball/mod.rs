// SPDX-License-Identifier: Apache-2.0
//! Pure Dragon Ball source projections shared by native Web, FFI and WASM.
//! Source documents are evidence, never an editorial or canonical approval.

mod archive;
pub mod catalogue;
mod gallery;
mod official;
mod reader;
pub mod structured;

pub use archive::archive_manifest;
pub use catalogue::{Catalogue, Collection, Publication, parse_collection, parse_miscellaneous};
pub use gallery::{Gallery, GalleryPage, Plate, parse_gallery, parse_plate_inventory};
pub use official::{OfficialArticle, parse_official_articles};
pub use reader::parse_reader_images;
pub use structured::{
    DialogueNode, EpisodeSynopsis, JumpStatistic, Translation, parse_jump_statistics,
    parse_toei_episodes, parse_translation,
};

/// Run a source parser without network, storage, runtime or platform ownership.
pub fn project_json(kind: &str, html: &str, base_url: &str, slug: &str) -> Result<String, String> {
    let url = url::Url::parse(base_url).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("projection requires a credential-free HTTP(S) source URL".into());
    }
    let value = match kind {
        "catalogue" => serde_json::to_value(parse_collection(html, slug, &url)),
        "gallery" => serde_json::to_value(parse_gallery(html, slug, &url)),
        "inventory" => serde_json::to_value(parse_plate_inventory(&crate::html_to_markdown(
            html,
            Some(base_url),
        ))),
        "toei" => serde_json::to_value(parse_toei_episodes(html, &url)),
        "jump" => serde_json::to_value(parse_jump_statistics(html)),
        "translation" => serde_json::to_value(parse_translation(html)),
        "official" => serde_json::to_value(parse_official_articles(html, &url)),
        "reader" => serde_json::to_value(parse_reader_images(html)?),
        _ => return Err(format!("unknown Dragon Ball projection kind: {kind}")),
    }
    .map_err(|error| error.to_string())?;
    serde_json::to_string(&value).map_err(|error| error.to_string())
}
