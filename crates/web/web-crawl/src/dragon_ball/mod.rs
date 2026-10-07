// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball crawl workflows migrated from integrated BXC and Shenron.
//! Network capture, pacing, retries and persistence remain Aphrody Web's owners.
//! Domain records retain their provenance and never imply editorial approval.

mod assets;
mod consolidation;
mod documents;
mod runner;
mod sources;

pub(crate) use aphrody_web_extract::dragon_ball::{catalogue, structured};

pub use aphrody_web_extract::dragon_ball::{
    Catalogue, Collection, DialogueNode, EpisodeSynopsis, Gallery, GalleryPage, JumpStatistic,
    OfficialArticle, Plate, Publication, parse_collection, parse_gallery, parse_jump_statistics,
    parse_miscellaneous, parse_official_articles, parse_plate_inventory, parse_toei_episodes,
};
pub use assets::{
    AcquiredAsset, AssetProbe, AssetResponse, DragonBallAssetOptions, DragonBallAssetReport,
    DragonBallAssetTransport, DragonBallImageRequest, acquire_manga_volume, plan_asset_requests,
    probe_assets, sync_assets, sync_assets_with_transport,
};
pub use consolidation::{ConsolidatedDragonBallReport, consolidate_bxc};
pub use documents::{DragonBallDocument, export_bxc, materialize_documents, project_document};
pub use runner::{DragonBallRunOptions, DragonBallRunReport, run_dragon_ball};
pub use sources::{DragonBallPlan, DragonBallTarget, source_registry, validate_source_url};

pub(crate) fn sha256(value: &str) -> String {
    sha256_bytes(value.as_bytes())
}
pub(crate) fn sha256_bytes(value: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write;
    let mut output = String::with_capacity(64);
    for byte in Sha256::digest(value) {
        write!(&mut output, "{byte:02x}").expect("writing into String");
    }
    output
}
