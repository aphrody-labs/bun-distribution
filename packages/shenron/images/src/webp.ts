import sharp from "sharp";
import { psnr } from "./pixels";

export interface ToWebpOptions {
	quality?: number;
	maxWidth?: number;
	/** Minimum PSNR (dB) against the (resized) source for the conversion to be accepted. Default 38. */
	minPsnr?: number;
	/** Reject when the output is not smaller than the source. Default true. */
	requireSmaller?: boolean;
}

export interface ToWebpResult {
	ok: boolean;
	reason?: string;
	buffer?: Buffer;
	width?: number;
	height?: number;
	inputBytes: number;
	outputBytes?: number;
	psnr?: number;
}

/**
 * Converts an image to WebP with a non-regression proof: the output is decoded and
 * compared to the source (resized to the same width with the same kernel) and must
 * reach `minPsnr`; it must also be smaller than the input. Nothing is written to
 * disk: the caller decides where the buffer goes, and always keeps the original.
 */
export async function toWebp(src: string | Uint8Array, opts: ToWebpOptions = {}): Promise<ToWebpResult> {
	const quality = opts.quality ?? 82;
	const minPsnr = opts.minPsnr ?? 38;
	const requireSmaller = opts.requireSmaller ?? true;
	const input = typeof src === "string" ? new Uint8Array(await Bun.file(src).arrayBuffer()) : src;
	const inputBytes = input.byteLength;
	const meta = await sharp(input, { failOn: "none", limitInputPixels: false }).metadata();
	const srcWidth = meta.width ?? 0;
	const targetWidth = opts.maxWidth && srcWidth > opts.maxWidth ? opts.maxWidth : srcWidth;
	if (!srcWidth) return { ok: false, reason: "unreadable source", inputBytes };

	let pipeline = sharp(input, { failOn: "none", limitInputPixels: false });
	if (targetWidth !== srcWidth) pipeline = pipeline.resize({ width: targetWidth, kernel: "lanczos3" });
	const out = await pipeline.webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });

	// Reference for the quality check: source resized the same way, kept raw.
	const reference =
		targetWidth !== srcWidth
			? await sharp(input, { failOn: "none", limitInputPixels: false })
					.resize({ width: targetWidth, kernel: "lanczos3" })
					.png({ compressionLevel: 0 })
					.toBuffer()
			: input;
	const quality_db = await psnr(reference, out.data);
	const outputBytes = out.data.byteLength;
	const base = { inputBytes, outputBytes, width: out.info.width, height: out.info.height, psnr: quality_db };
	if (quality_db < minPsnr) return { ok: false, reason: `psnr ${quality_db.toFixed(2)} dB < ${minPsnr}`, ...base };
	if (requireSmaller && outputBytes >= inputBytes)
		return { ok: false, reason: `output ${outputBytes} B not smaller than ${inputBytes} B`, ...base };
	return { ok: true, buffer: out.data, ...base };
}
