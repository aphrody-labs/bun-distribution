//! SoundCraft video: open a movie (MP4 / QuickTime MOV) from bytes, report its picture format, and
//! decode the frame at a time to RGBA for the Video window and the Video track's thumbnails.
//!
//! - [`Movie::open`] (bytes) / [`Movie::open_source`] (any random-access [`ByteSource`]).
//! - [`Movie::info`]: size, duration, frame rate, codec, whether it can be decoded.
//! - [`Movie::frame_at`]: the frame shown at a time, decoded forward from the previous keyframe,
//!   with a small LRU of decoded frames (sequential playback keeps decoding forward).
//! - [`Movie::thumbnail_at`] / [`Movie::thumbnails`]: low-resolution timeline pictures (keyframes).
//! - Unsupported codecs open fine (so the timeline can show the clip) but frame requests return
//!   [`VideoError::Unsupported`]. Malformed files return errors; nothing here panics.
//!
//! Picture codecs: H.264 / AVC (Baseline, Main, High; progressive 8-bit 4:2:0; CAVLC and CABAC),
//! Apple ProRes (422 Proxy/LT/Standard/HQ, 4444/XQ) and Motion JPEG (`jpeg`/`mjpa`).
//!
//! ## Codecs
//!
//! The container, H.264 and ProRes code comes from the shared clean-room crates, re-exported under
//! their historical module paths: `filmcraft-bitstream` as [`bitstream`], `filmcraft-isobmff` as
//! [`isobmff`], `filmcraft-h264` as [`h264`] and `filmcraft-prores` as [`prores`]. [`Movie`], the
//! pixel conversion and the frame caches are SoundCraft's own.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
// Codec code indexes fixed-size blocks; index loops read more clearly than iterator chains there.
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

pub use filmcraft_bitstream as bitstream;
pub use filmcraft_h264 as h264;
pub use filmcraft_isobmff as isobmff;
pub use filmcraft_prores as prores;

pub mod convert;
mod movie;
pub mod synth;

pub use isobmff::ByteSource;
pub use movie::{Frame, Movie, MovieInfo, SharedSource, fit_size};

/// Errors from opening or decoding a movie.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum VideoError {
    #[error("not a readable movie: {0}")]
    Container(String),
    #[error("the movie has no video track")]
    NoVideoTrack,
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("could not decode the picture: {0}")]
    Decode(String),
    #[error("no picture at that time")]
    OutOfRange,
}

pub type Result<T> = std::result::Result<T, VideoError>;

/// Open a movie and return its description (convenience for importers).
pub fn probe(bytes: &[u8]) -> Result<MovieInfo> {
    Movie::open(bytes.to_vec()).map(|m| m.info().clone())
}

#[cfg(test)]
mod tests;
