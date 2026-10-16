// SPDX-License-Identifier: Apache-2.0

//! Optimization through usvg's normalizing writer: CSS, `<use>`, inheritance, shapes and units
//! are resolved into absolute paths, invisible elements are dropped, and numbers are bounded to
//! a precision. This is the Rust counterpart of svgo's `preset-default` for rendering-only
//! output; it trades editability (no classes, no `<style>`) for a deterministic, safe document.

use resvg::usvg;

use crate::{Result, raster::parse_tree};

/// Writer settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OptimizeOptions {
    /// Decimals kept for coordinates.
    pub coordinates_precision: u8,
    /// Decimals kept for transform matrices.
    pub transforms_precision: u8,
    /// Keep `<text>` as text (needs the same fonts where rendered) instead of converting it to
    /// paths with the system fonts.
    pub preserve_text: bool,
    /// Indent the output (two spaces) instead of writing one line.
    pub pretty: bool,
}

impl Default for OptimizeOptions {
    fn default() -> Self {
        Self {
            coordinates_precision: 3,
            transforms_precision: 5,
            preserve_text: false,
            pretty: false,
        }
    }
}

/// Returns the optimized SVG.
///
/// # Errors
/// [`crate::Error::Parse`] when usvg rejects the input.
pub fn optimize(svg: &str, options: OptimizeOptions) -> Result<String> {
    let tree = parse_tree(svg, !options.preserve_text)?;
    let write = usvg::WriteOptions {
        preserve_text: options.preserve_text,
        coordinates_precision: options.coordinates_precision,
        transforms_precision: options.transforms_precision,
        indent: if options.pretty { usvg::Indent::Spaces(2) } else { usvg::Indent::None },
        attributes_indent: usvg::Indent::None,
        ..usvg::WriteOptions::default()
    };
    Ok(tree.to_string(&write))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_css_and_shapes() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- c --><style>.a{fill:#00f}</style><metadata>x</metadata><rect class="a" x="1.123456" y="1" width="2" height="2"/><rect width="0" height="0"/></svg>"#;
        let out = optimize(svg, OptimizeOptions::default()).expect("ok");
        assert!(out.contains("<path"), "{out}");
        assert!(out.contains("#0000ff"), "{out}");
        assert!(out.contains("1.123"), "{out}");
        assert!(
            !out.contains("1.1234") && !out.contains("<style") && !out.contains("metadata"),
            "{out}"
        );
        assert!(out.len() < svg.len() + 200);
    }
}
