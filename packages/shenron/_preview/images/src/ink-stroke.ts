// SPDX-License-Identifier: Apache-2.0
/**
 * ink-stroke.ts — median ink stroke width of a manga page (Toriyama line calibration).
 *
 * Moved from `AphrodyNativeBridge.measureInkStroke` (@shenron/pipeline/aphrody, B16) with the
 * same algorithm and output: about 60 evenly spaced rows are scanned, every run of
 * dark pixels (Rec. 709 luminance < 60) shorter than 10 % of the width is a stroke
 * sample, and the result is the upper median of those run lengths.
 */

import sharp from "sharp";

export interface InkStrokeMeasure {
	width: number;
	height: number;
	medianStrokePx: number;
	sampleCount: number;
}

/** Measures the median stroke width of an image (file path or encoded buffer). */
export async function measureInkStroke(image: string | Buffer): Promise<InkStrokeMeasure> {
	const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;
	const C = info.channels;
	const strokeWidths: number[] = [];

	const stepY = Math.max(1, Math.floor(H / 60));
	for (let y = stepY; y < H; y += stepY) {
		let inStroke = false;
		let len = 0;
		for (let x = 0; x < W; x++) {
			const idx = (y * W + x) * C;
			const r = data[idx]!;
			const g = data[idx + 1]!;
			const b = data[idx + 2]!;
			const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			if (lum < 60) {
				inStroke = true;
				len++;
			} else {
				if (inStroke && len >= 1 && len < W * 0.1) {
					strokeWidths.push(len);
				}
				inStroke = false;
				len = 0;
			}
		}
	}

	strokeWidths.sort((a, b) => a - b);
	const medianStrokePx = strokeWidths[Math.floor(strokeWidths.length / 2)] || 0;
	return { width: W, height: H, medianStrokePx, sampleCount: strokeWidths.length };
}
