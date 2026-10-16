use std::path::Path;

use crate::svg_raster::{self as raster, RenderOptions};
use crate::{Error, ImageHandler, Result, consts::SVG_TARGET_PX, scale_dimensions};
use image::DynamicImage;

#[derive(PartialEq, Eq)]
pub struct SvgHandler {}

impl ImageHandler for SvgHandler {
	#[allow(clippy::cast_precision_loss)]
	fn handle_image(&self, path: &Path) -> Result<DynamicImage> {
		let data = self.get_data(path)?;
		let svg = std::str::from_utf8(&data).map_err(|_| Error::InvalidPath)?;

		// Parse once at the intrinsic size to compute the scaled target, then render directly
		// at that size (single rasterization pass).
		let tree = raster::parse_tree(svg)?;
		let (intrinsic_width, intrinsic_height) = raster::intrinsic_size(&tree);

		let (scaled_w, scaled_h) =
			scale_dimensions(intrinsic_width as f32, intrinsic_height as f32, SVG_TARGET_PX);

		let (width, height) = if intrinsic_width > intrinsic_height {
			(Some(scaled_w), None)
		} else {
			(None, Some(scaled_h))
		};

		let scaled = raster::render_tree(&tree, RenderOptions { width, height })?;

		image::RgbaImage::from_raw(scaled.width, scaled.height, scaled.rgba)
			.map_or_else(|| Err(Error::RgbImageConversion), |x| Ok(DynamicImage::ImageRgba8(x)))
	}
}
