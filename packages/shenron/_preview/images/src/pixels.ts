import sharp from "sharp";

export interface PixelEqualityResult {
	equal: boolean;
	reason?: string;
	width?: number;
	height?: number;
	differingPixels?: number;
	maxDelta?: number;
}

async function decodeRgba(input: string | Uint8Array) {
	const { data, info } = await sharp(input, { failOn: "none", limitInputPixels: false })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

/**
 * Proves two images are identical pixel for pixel by decoding both to raw RGBA and
 * comparing the buffers. Never trusts dimensions or file size alone (sharp palettises
 * PNG on re-encode: see memory sharp-png-not-lossless).
 */
export async function provePixelEquality(
	a: string | Uint8Array,
	b: string | Uint8Array
): Promise<PixelEqualityResult> {
	const [x, y] = await Promise.all([decodeRgba(a), decodeRgba(b)]);
	if (x.width !== y.width || x.height !== y.height) {
		return {
			equal: false,
			reason: `dimensions differ: ${x.width}x${x.height} vs ${y.width}x${y.height}`,
			width: x.width,
			height: x.height,
		};
	}
	if (x.data.equals(y.data)) return { equal: true, width: x.width, height: x.height };
	let differing = 0;
	let maxDelta = 0;
	for (let i = 0; i < x.data.length; i += 4) {
		let d = 0;
		for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(x.data[i + k]! - y.data[i + k]!));
		if (d > 0) differing++;
		if (d > maxDelta) maxDelta = d;
	}
	return {
		equal: false,
		reason: `${differing} differing pixel(s), max delta ${maxDelta}`,
		width: x.width,
		height: x.height,
		differingPixels: differing,
		maxDelta,
	};
}

/** French alias kept for the operational scripts. */
export const prouverEgalitePixels = provePixelEquality;

/** PSNR (dB) between two same-sized images; Infinity when identical. */
export async function psnr(a: string | Uint8Array, b: string | Uint8Array): Promise<number> {
	const [x, y] = await Promise.all([decodeRgba(a), decodeRgba(b)]);
	if (x.width !== y.width || x.height !== y.height) return 0;
	let se = 0;
	for (let i = 0; i < x.data.length; i++) {
		const d = x.data[i]! - y.data[i]!;
		se += d * d;
	}
	if (se === 0) return Number.POSITIVE_INFINITY;
	const mse = se / x.data.length;
	return 10 * Math.log10((255 * 255) / mse);
}
