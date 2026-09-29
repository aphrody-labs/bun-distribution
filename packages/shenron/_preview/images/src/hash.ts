import sharp from "sharp";

/** SHA-256 (hex) of the full file content, streamed so large scans do not load in RAM. */
export async function hashFile(path: string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	const stream = Bun.file(path).stream();
	for await (const chunk of stream) hasher.update(chunk);
	return hasher.digest("hex");
}

/** SHA-256 (hex) of an in-memory buffer. */
export function hashBuffer(buf: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(buf).digest("hex");
}

/**
 * 64-bit difference hash: grayscale, resized to 9x8, each bit = pixel[x] > pixel[x+1].
 * Two images of the same picture at different resolutions get (near-)identical hashes.
 * Returned as a 16-char hex string.
 */
export async function dHash(input: string | Uint8Array): Promise<string> {
	const raw = await sharp(input, { failOn: "none", limitInputPixels: false })
		.grayscale()
		.resize(9, 8, { fit: "fill", kernel: "lanczos3" })
		.raw()
		.toBuffer();
	let bits = 0n;
	for (let y = 0; y < 8; y++) {
		for (let x = 0; x < 8; x++) {
			const left = raw[y * 9 + x] ?? 0;
			const right = raw[y * 9 + x + 1] ?? 0;
			bits = (bits << 1n) | (left > right ? 1n : 0n);
		}
	}
	return bits.toString(16).padStart(16, "0");
}

/** Hamming distance between two hex hashes of equal length. */
export function hammingDistance(a: string, b: string): number {
	let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
	let n = 0;
	while (x) {
		n += Number(x & 1n);
		x >>= 1n;
	}
	return n;
}
