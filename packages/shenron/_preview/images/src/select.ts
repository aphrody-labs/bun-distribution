/**
 * Sourced illustration picking. The library never invents an image: every
 * candidate comes from a provider that reads our own hosted material (XV2
 * portraits, manga scans, databook plates, anime frames). Providers are injected
 * so the selection logic stays testable without a database.
 */
import { bestVariant, type ImageVariant } from "./variants";

export type IllustrationSource = "xv2" | "manga" | "databook" | "anime";

export interface IllustrationEntity {
	type: string;
	id: number | string;
	name: string;
	nameJa?: string | null;
	nameRomaji?: string | null;
	/** Chapter ids or numbers already linked to the entity (manga provider hint). */
	chapterIds?: (number | string)[];
}

export interface IllustrationCandidate extends ImageVariant {
	source: IllustrationSource;
	/** Human-readable provenance: databook title + page, chapter, XV2 code… */
	provenance: string;
	/** 0..1 confidence that the picture shows the entity (name match strength). */
	confidence: number;
	/** Optional stable reference (databook id, chapter id, xv2 code). */
	ref?: string;
}

export interface IllustrationProvider {
	(entity: IllustrationEntity): Promise<IllustrationCandidate[]>;
}

export interface SelectIllustrationInput {
	entite: IllustrationEntity;
	sources: IllustrationSource[];
	providers: Partial<Record<IllustrationSource, IllustrationProvider>>;
	/** Minimum width to accept (default 400). */
	minWidth?: number;
	/** Minimum confidence to accept (default 0.6). */
	minConfidence?: number;
}

export interface SelectedIllustration extends IllustrationCandidate {
	score: number;
}

/** Source priority: a portrait made for the character beats a page where it merely appears. */
const SOURCE_WEIGHT: Record<IllustrationSource, number> = {
	xv2: 1.0,
	databook: 0.85,
	anime: 0.7,
	manga: 0.6,
};

export function scoreCandidate(c: IllustrationCandidate, minWidth: number): number {
	const w = c.width ?? 0;
	const resolution = Math.min(w / (minWidth * 2), 1); // saturates at 2×minWidth
	return c.confidence * SOURCE_WEIGHT[c.source] * (0.5 + 0.5 * resolution);
}

/**
 * Returns the best sourced candidate or null. Sources are queried in the order
 * given; within the same source, the largest variant wins; across sources, the
 * score (confidence × source weight × resolution) decides.
 */
export async function selectionnerIllustration(
	input: SelectIllustrationInput
): Promise<SelectedIllustration | null> {
	const minWidth = input.minWidth ?? 400;
	const minConfidence = input.minConfidence ?? 0.6;
	let best: SelectedIllustration | null = null;
	for (const source of input.sources) {
		const provider = input.providers[source];
		if (!provider) continue;
		const candidates = (await provider(input.entite)).filter(
			(c) => c.source === source && c.path && c.confidence >= minConfidence && (c.width ?? 0) >= minWidth
		);
		if (!candidates.length) continue;
		// Group by provenance ref so several resolutions of one plate collapse to the best.
		const byRef = new Map<string, IllustrationCandidate[]>();
		for (const c of candidates) {
			const key = c.ref ?? c.path;
			byRef.set(key, [...(byRef.get(key) ?? []), c]);
		}
		for (const group of byRef.values()) {
			const top = bestVariant(group);
			if (!top) continue;
			const score = scoreCandidate(top, minWidth);
			if (!best || score > best.score) best = { ...top, score };
		}
	}
	return best;
}

export const selectIllustration = selectionnerIllustration;
