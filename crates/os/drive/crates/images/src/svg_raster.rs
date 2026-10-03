// SPDX-License-Identifier: Apache-2.0
// Adapted from crates/ui/svg/src/raster.rs for the OS-owned
// sd-images crate. Keep the same resvg 0.47 size, font and alpha behavior.

use std::sync::{Arc, OnceLock};

use resvg::{tiny_skia, usvg};

use crate::{Error, Result};

#[derive(Clone, Copy)]
pub struct RenderOptions {
	pub width: Option<u32>,
	pub height: Option<u32>,
}

pub struct Raster {
	pub width: u32,
	pub height: u32,
	pub rgba: Vec<u8>,
}

fn system_fontdb() -> Arc<usvg::fontdb::Database> {
	static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
	DB.get_or_init(|| {
		let mut db = usvg::fontdb::Database::new();
		db.load_system_fonts();
		Arc::new(db)
	})
	.clone()
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn px(value: f32) -> u32 {
	value.round().clamp(1.0, f32::from(u16::MAX)) as u32
}

pub fn parse_tree(svg: &str) -> Result<usvg::Tree> {
	let parse_options = usvg::Options { fontdb: system_fontdb(), ..usvg::Options::default() };
	usvg::Tree::from_str(svg, &parse_options).map_err(|error| Error::Svg(error.to_string()))
}

pub fn intrinsic_size(tree: &usvg::Tree) -> (u32, u32) {
	let size = tree.size();
	(px(size.width()), px(size.height()))
}

// resvg and tiny-skia use f32 geometry; output dimensions are bounded by the
// image allocator before conversion.
#[allow(clippy::cast_precision_loss)]
pub fn render_tree(tree: &usvg::Tree, options: RenderOptions) -> Result<Raster> {
	let size = tree.size();
	let (width, height) = match (options.width, options.height) {
		(Some(width), Some(height)) => (width, height),
		(Some(width), None) => (width, px(size.height() * width as f32 / size.width())),
		(None, Some(height)) => (px(size.width() * height as f32 / size.height()), height),
		(None, None) => (px(size.width()), px(size.height())),
	};
	if width == 0 || height == 0 {
		return Err(Error::Svg("zero output size".into()));
	}
	let mut pixmap = tiny_skia::Pixmap::new(width, height)
		.ok_or_else(|| Error::Svg(format!("cannot allocate {width}x{height}")))?;
	let transform = tiny_skia::Transform::from_scale(
		width as f32 / size.width(),
		height as f32 / size.height(),
	);
	resvg::render(tree, transform, &mut pixmap.as_mut());
	let rgba = pixmap
		.pixels()
		.iter()
		.flat_map(|pixel| {
			let color = pixel.demultiply();
			[color.red(), color.green(), color.blue(), color.alpha()]
		})
		.collect();
	Ok(Raster { width: pixmap.width(), height: pixmap.height(), rgba })
}
