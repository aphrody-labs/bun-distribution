// SPDX-License-Identifier: Apache-2.0
//! Bounded rendering of untrusted M3 canvas scenes (the public `/api/v1/canvas/render` endpoint).
//!
//! Hosts in lower layers (the `aphrody-site` server in aphrody-web) must not link this crate
//! (docs/REPO-LAYERING.md); they run the `aphrody-canvas` binary, which reads one
//! scene as JSON on stdin and writes the PNG to stdout through [`render_untrusted`].

use crate::{
    RenderSurface, SurfaceKind,
    raster::render_scene_png,
    rgba8_len,
    scene::{Corners, Node, Rect, Scene},
};

/// Largest canvas side, in pixels.
pub const MAX_DIMENSION: u32 = 1024;
/// Largest RGBA8 buffer (canvas or embedded image), in bytes.
pub const MAX_RGBA_BYTES: usize = 4 * 1024 * 1024;
/// Largest accepted JSON request, in bytes.
pub const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
/// Largest node count.
pub const MAX_NODES: usize = 64;
/// Largest text node, in bytes.
pub const MAX_TEXT_BYTES: usize = 1024;
/// Largest icon path, in bytes.
pub const MAX_ICON_BYTES: usize = 4096;

/// Why an untrusted scene was not rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanvasError {
    /// The request is not a JSON scene (or exceeds [`MAX_REQUEST_BYTES`]).
    InvalidJson,
    /// The scene violates a bound; the reason is safe to return to the client.
    InvalidScene(&'static str),
    /// PNG encoding failed.
    RenderFailed(String),
}

impl CanvasError {
    /// Process exit code of `aphrody canvas`.
    #[must_use]
    pub const fn exit_code(&self) -> i32 {
        match self {
            Self::InvalidJson => 2,
            Self::InvalidScene(_) => 3,
            Self::RenderFailed(_) => 4,
        }
    }
}

impl std::fmt::Display for CanvasError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson => f.write_str("invalid JSON scene"),
            Self::InvalidScene(reason) => f.write_str(reason),
            Self::RenderFailed(error) => write!(f, "render failed: {error}"),
        }
    }
}

impl std::error::Error for CanvasError {}

/// Parse, validate and render one untrusted scene to PNG.
///
/// # Errors
/// [`CanvasError`] when the request is not a scene, violates a bound or cannot be encoded.
pub fn render_untrusted(body: &[u8]) -> Result<Vec<u8>, CanvasError> {
    if body.len() > MAX_REQUEST_BYTES {
        return Err(CanvasError::InvalidJson);
    }
    let scene: Scene = serde_json::from_slice(body).map_err(|_| CanvasError::InvalidJson)?;
    validate_scene(&scene).map_err(CanvasError::InvalidScene)?;
    render_scene_png(&scene).map_err(|error| CanvasError::RenderFailed(error.to_string()))
}

/// Check every bound an untrusted scene must respect before it is rasterized.
///
/// # Errors
/// A client-facing reason for the first violated bound.
pub fn validate_scene(scene: &Scene) -> Result<(), &'static str> {
    if scene.width == 0
        || scene.height == 0
        || scene.width > MAX_DIMENSION
        || scene.height > MAX_DIMENSION
    {
        return Err("canvas dimensions must be between 1 and 1024 pixels");
    }
    let surface = RenderSurface::new(SurfaceKind::NativeCanvas, scene.width, scene.height, 1000);
    if surface.checked_physical_size() != Some((scene.width, scene.height))
        || !matches!(rgba8_len(scene.width, scene.height), Some(len) if len <= MAX_RGBA_BYTES)
    {
        return Err("canvas allocation exceeds the limit");
    }
    if scene.nodes.len() > MAX_NODES {
        return Err("too many canvas nodes");
    }
    if !scene.contrast_level.is_finite() || !(-1.0..=1.0).contains(&scene.contrast_level) {
        return Err("invalid contrast level");
    }

    for node in &scene.nodes {
        match node {
            Node::Surface { rect, corners, elevation, outline, .. } => {
                validate_rect(*rect, scene.width, scene.height)?;
                validate_corners(*corners)?;
                if *elevation > 5 {
                    return Err("invalid elevation");
                }
                if let Some(outline) = outline
                    && (!outline.width.is_finite() || !(0.0..=32.0).contains(&outline.width))
                {
                    return Err("invalid outline width");
                }
            },
            Node::StateLayer { rect, corners, .. } => {
                validate_rect(*rect, scene.width, scene.height)?;
                validate_corners(*corners)?;
            },
            Node::Ripple { cx, cy, radius, alpha, .. } => {
                if !cx.is_finite()
                    || !cy.is_finite()
                    || !radius.is_finite()
                    || !alpha.is_finite()
                    || *radius <= 0.0
                    || !(0.0..=1.0).contains(alpha)
                    || cx - radius < 0.0
                    || cy - radius < 0.0
                    || cx + radius > scene.width as f32
                    || cy + radius > scene.height as f32
                {
                    return Err("invalid ripple geometry");
                }
            },
            Node::Text { rect, text, .. } => {
                validate_rect(*rect, scene.width, scene.height)?;
                if text.len() > MAX_TEXT_BYTES {
                    return Err("text exceeds the limit");
                }
            },
            Node::Icon { rect, path, .. } => {
                validate_rect(*rect, scene.width, scene.height)?;
                if path.len() > MAX_ICON_BYTES {
                    return Err("icon path exceeds the limit");
                }
            },
            Node::Image { rect, width, height, rgba } => {
                validate_rect(*rect, scene.width, scene.height)?;
                if !matches!(rgba8_len(*width, *height), Some(len) if len == rgba.len() && len <= MAX_RGBA_BYTES)
                {
                    return Err("invalid RGBA image buffer");
                }
            },
        }
    }
    Ok(())
}

fn validate_rect(rect: Rect, width: u32, height: u32) -> Result<(), &'static str> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.w.is_finite()
        || !rect.h.is_finite()
        || rect.x < 0.0
        || rect.y < 0.0
        || rect.w <= 0.0
        || rect.h <= 0.0
        || rect.x + rect.w > width as f32
        || rect.y + rect.h > height as f32
    {
        return Err("invalid node bounds");
    }
    Ok(())
}

fn validate_corners(corners: Corners) -> Result<(), &'static str> {
    for radius in [corners.tl, corners.tr, corners.br, corners.bl] {
        if !radius.is_finite() || !(0.0..=MAX_DIMENSION as f32).contains(&radius) {
            return Err("invalid corner radius");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::scene::{Paint, Rgba8, TypeStyleName};

    fn scene(fill: Rgba8) -> Scene {
        serde_json::from_value(json!({
            "width": 64,
            "height": 48,
            "seed_argb": 4285010084u32,
            "background": { "kind": "fixed", "value": { "r": 255, "g": 255, "b": 255, "a": 255 } },
            "nodes": [{
                "node": "surface",
                "rect": { "x": 8.0, "y": 8.0, "w": 40.0, "h": 30.0 },
                "corners": { "tl": 8.0, "tr": 8.0, "br": 8.0, "bl": 8.0 },
                "fill": { "kind": "fixed", "value": fill },
                "elevation": 0
            }]
        }))
        .unwrap()
    }

    #[test]
    fn renders_scene_specific_pngs() {
        assert_eq!(render_untrusted(b"invalid JSON"), Err(CanvasError::InvalidJson));
        let red = render_untrusted(
            &serde_json::to_vec(&scene(Rgba8 { r: 255, g: 0, b: 0, a: 255 })).unwrap(),
        )
        .unwrap();
        let blue = render_untrusted(
            &serde_json::to_vec(&scene(Rgba8 { r: 0, g: 0, b: 255, a: 255 })).unwrap(),
        )
        .unwrap();
        assert_eq!(&red[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(u32::from_be_bytes(red[16..20].try_into().unwrap()), 64);
        assert_eq!(u32::from_be_bytes(red[20..24].try_into().unwrap()), 48);
        assert_ne!(red, blue);
    }

    #[test]
    fn rejects_hostile_allocations_and_geometry() {
        let mut canvas = scene(Rgba8::BLACK);
        canvas.width = u32::MAX;
        assert!(validate_scene(&canvas).is_err());

        let mut canvas = scene(Rgba8::BLACK);
        canvas.nodes.push(Node::Image {
            rect: Rect::new(0.0, 0.0, 1.0, 1.0),
            width: u32::MAX,
            height: u32::MAX,
            rgba: vec![0; 4],
        });
        assert!(validate_scene(&canvas).is_err());

        let mut canvas = scene(Rgba8::BLACK);
        canvas.nodes.push(Node::Text {
            rect: Rect::new(0.0, 0.0, 1.0e20, 1.0),
            text: "x".into(),
            style: TypeStyleName::BodyLarge,
            color: Paint::Fixed(Rgba8::BLACK),
        });
        assert_eq!(
            render_untrusted(&serde_json::to_vec(&canvas).unwrap()),
            Err(CanvasError::InvalidScene("invalid node bounds"))
        );
    }
}
