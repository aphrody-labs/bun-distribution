// SPDX-License-Identifier: Apache-2.0
//! Local MPEG-7 ColorLayout frame search and trace.moe vector client.

pub mod descriptor;
mod error;
pub mod index;
pub mod media;
pub mod service;
pub mod trace_moe;

pub use descriptor::{
    ColorLayoutVector, VECTOR_LENGTH, color_layout_distance, encode_color_layout,
    similarity_from_distance,
};
pub use error::{FramesError, Result};
pub use index::{FramesIndex, FramesStats, MediaMeta, MediaRow, SceneMatch, SearchOptions};
pub use media::{extract_vector, index_video};
pub use service::{
    FramesClient, FramesSearchMode, FramesSearchOptions, FramesSearchOutput, FramesVectorOutput,
    parse_timecode, vector_from_bytes,
};
pub use trace_moe::{Quota, TraceMatch, TraceMoeClient};
