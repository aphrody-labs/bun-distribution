/**
 * Pure (no sharp, no I/O) selection of the best variant among images that show
 * the same picture. Safe to import from the site bundle.
 */
export interface ImageVariant {
	path: string;
	width?: number | null;
	height?: number | null;
	bytes?: number | null;
	/** Lower-case format/extension: png, webp, jpg, jpeg, gif, avif. */
	format?: string | null;
}

const FORMAT_RANK: Record<string, number> = {
	png: 3,
	avif: 2,
	webp: 2,
	jpg: 1,
	jpeg: 1,
	gif: 0,
};

function formatOf(v: ImageVariant): string {
	if (v.format) return v.format.toLowerCase();
	const m = /\.([a-z0-9]+)(?:$|\?)/i.exec(v.path);
	return (m?.[1] ?? "").toLowerCase();
}

/** Score = pixel count first, then lossless/modern format, then bytes (as quality proxy). */
export function variantScore(v: ImageVariant): number {
	const pixels = (v.width ?? 0) * (v.height ?? 0);
	const fmt = FORMAT_RANK[formatOf(v)] ?? 0;
	const bytes = v.bytes ?? 0;
	// pixels dominate; format breaks ties; bytes break remaining ties.
	return pixels * 16 + fmt * 4 + Math.min(bytes / 1_000_000, 3);
}

/**
 * Picks the variant with the largest resolution (then best format, then size).
 * Returns null on an empty list. Candidates without dimensions rank last but are
 * still eligible (a lone candidate is always returned).
 */
export function bestVariant<T extends ImageVariant>(candidates: readonly T[]): T | null {
	let best: T | null = null;
	let bestScore = -1;
	for (const c of candidates) {
		if (!c?.path) continue;
		const s = variantScore(c);
		if (s > bestScore) {
			best = c;
			bestScore = s;
		}
	}
	return best;
}

/** True when `a` is at least as large as `b` on both axes (so it can replace it). */
export function coversResolution(a: ImageVariant, b: ImageVariant): boolean {
	return (a.width ?? 0) >= (b.width ?? 0) && (a.height ?? 0) >= (b.height ?? 0);
}
