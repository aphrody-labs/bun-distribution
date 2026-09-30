// SPDX-License-Identifier: Apache-2.0

/// Errors produced by `aphrody-svg`.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The input is not well-formed XML (DTDs are rejected on purpose: no entity expansion).
    #[error("invalid SVG XML: {0}")]
    Xml(String),
    /// The root element is not `<svg>` in the SVG namespace.
    #[error("root element is not <svg>")]
    NotSvg,
    /// The document has no usable size (no `viewBox` and no `width`/`height`).
    #[error("SVG has no usable size")]
    NoSize,
    /// usvg rejected the document.
    #[error("SVG parse failed: {0}")]
    Parse(String),
    /// A raster buffer could not be allocated or encoded.
    #[error("raster failed: {0}")]
    Raster(String),
    /// A font could not be read.
    #[error("font error: {0}")]
    Font(String),
    /// An argument is out of range.
    #[error("invalid argument: {0}")]
    Invalid(String),
}

/// `Result` alias for this crate.
pub type Result<T> = core::result::Result<T, Error>;
