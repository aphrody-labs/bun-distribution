// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/eval` — RAG retrieval metrics on the gold set.
 *
 * Runtime class: `pure`. Logic moved from `apps/bot/src/lib/rag-eval.ts`
 * with identical results (one definition of "finding the right source").
 *
 * A gold case:
 *   - `q`           the question;
 *   - `expectUrl`   (preferred) URL prefixes of the expected source, matched
 *                   with a path boundary;
 *   - `expectTitle` substring of the expected source TITLE;
 *   - `expect`      (legacy) substrings searched in title or snippet;
 *   - `tags`        free buckets to split the scores.
 * A case carrying `expectUrl`/`expectTitle` ignores `expect` (diagnostics only).
 */

export interface GoldCase {
	q: string;
	expect?: string[];
	expectUrl?: string[];
	/** Substring of the expected source TITLE, when its URL is not reliable. */
	expectTitle?: string[];
	lang?: string;
	tags?: string[];
}

/** Minimal hit shape the metrics read. */
export interface EvalHit {
	title: string;
	snippet: string;
	url: string;
	kind: string;
}

export const RANKS = [1, 3, 5, 10] as const;

/** Comparable URL path: no origin, no trailing slash, lower case. */
export function normalizeUrl(url: string): string {
	return (url || "")
		.trim()
		.replace(/^https?:\/\/(www\.)?dragonballfr\.com/i, "")
		.replace(/\/+(?=$|[?#])/, "")
		.toLowerCase();
}

/** URL match with a boundary: `/freezer` does not validate `/freezer-futur`. */
export function matchesExpectedUrl(actual: string, expected: string): boolean {
	const url = normalizeUrl(actual);
	const prefix = normalizeUrl(expected);
	if (!prefix) return false;
	return (
		url === prefix ||
		url.startsWith(`${prefix}#`) ||
		url.startsWith(`${prefix}?`) ||
		url.startsWith(`${prefix}/`)
	);
}

/** Does the hit satisfy the case? */
export function isHit(hit: Pick<EvalHit, "title" | "snippet" | "url">, c: GoldCase): boolean {
	if (c.expectUrl?.length || c.expectTitle?.length) {
		const url = normalizeUrl(hit.url);
		const title = hit.title.toLowerCase();
		return (
			(c.expectUrl ?? []).some((p) => matchesExpectedUrl(url, p)) ||
			(c.expectTitle ?? []).some((t) => title.includes(t.toLowerCase()))
		);
	}
	const hay = `${hit.title}\n${hit.snippet}`.toLowerCase();
	return (c.expect ?? []).some((m) => hay.includes(m.toLowerCase()));
}

/** 1-based rank of the first correct hit, 0 when none. */
export function firstHitRank(
	results: readonly Pick<EvalHit, "title" | "snippet" | "url">[],
	c: GoldCase
): number {
	for (let i = 0; i < results.length; i++) if (isHit(results[i]!, c)) return i + 1;
	return 0;
}

function binaryNdcg(flags: readonly boolean[], k: number): number {
	let dcg = 0;
	let hits = 0;
	for (let i = 0; i < Math.min(k, flags.length); i++) {
		if (flags[i]) {
			dcg += 1 / Math.log2(i + 2);
			hits++;
		}
	}
	if (hits === 0) return 0;
	let idcg = 0;
	for (let i = 0; i < hits; i++) idcg += 1 / Math.log2(i + 2);
	return dcg / idcg;
}

function urlFlags(ranked: readonly string[], expected: readonly string[]): boolean[] {
	return ranked.map((url) => expected.some((prefix) => matchesExpectedUrl(url, prefix)));
}

/**
 * Binary-gain nDCG@k. The IDCG assumes every correct hit found is at the top;
 * without a correct hit in the top k, nDCG = 0.
 *
 * Two forms: `(hits, goldCase, k = 10)` (rag-eval.ts) or
 * `(rankedUrls, expectedUrlPrefixes, k)`.
 */
export function ndcgAtK(
	results: readonly Pick<EvalHit, "title" | "snippet" | "url">[],
	c: GoldCase,
	k?: number
): number;
export function ndcgAtK(ranked: readonly string[], expected: readonly string[], k: number): number;
export function ndcgAtK(
	results: readonly (string | Pick<EvalHit, "title" | "snippet" | "url">)[],
	c: GoldCase | readonly string[],
	k = 10
): number {
	if (Array.isArray(c))
		return binaryNdcg(urlFlags(results as readonly string[], c as readonly string[]), k);
	const gold = c as GoldCase;
	return binaryNdcg(
		(results as readonly Pick<EvalHit, "title" | "snippet" | "url">[]).map((hit) =>
			isHit(hit, gold)
		),
		k
	);
}

/** 1 when a ranked URL within the top `k` matches an expected prefix, else 0. */
export function recallAtK(
	ranked: readonly string[],
	expected: readonly string[],
	k: number
): number {
	return urlFlags(ranked.slice(0, k), expected).some(Boolean) ? 1 : 0;
}

/** Reciprocal rank of the first ranked URL matching an expected prefix (0 when none). */
export function mrr(ranked: readonly string[], expected: readonly string[]): number {
	const index = urlFlags(ranked, expected).indexOf(true);
	return index < 0 ? 0 : 1 / (index + 1);
}

export interface Metrics {
	cases: number;
	recall: Record<(typeof RANKS)[number], number>;
	mrr: number;
	ndcg: number;
}

export interface CaseResult {
	case: GoldCase;
	rank: number;
	ndcg: number;
	top: { title: string; url: string; kind: string }[];
	latencyMs: number;
	mode: string;
}

export function aggregate(results: readonly CaseResult[]): Metrics {
	const n = results.length || 1;
	const within = (k: number) => results.filter((r) => r.rank > 0 && r.rank <= k).length / n;
	return {
		cases: results.length,
		recall: { 1: within(1), 3: within(3), 5: within(5), 10: within(10) },
		mrr: results.reduce((acc, r) => acc + (r.rank > 0 ? 1 / r.rank : 0), 0) / n,
		ndcg: results.reduce((acc, r) => acc + r.ndcg, 0) / n,
	};
}

/** Scores split by tag (a case counts in each of its tags). */
export function aggregateByTag(results: readonly CaseResult[]): Record<string, Metrics> {
	const groups = new Map<string, CaseResult[]>();
	for (const r of results) {
		for (const t of r.case.tags ?? ["sans-tag"]) {
			const g = groups.get(t) ?? [];
			g.push(r);
			groups.set(t, g);
		}
	}
	return Object.fromEntries([...groups].toSorted().map(([t, g]) => [t, aggregate(g)]));
}

/** Parses the gold JSONL; invalid lines are skipped, not fatal. */
export function parseGold(text: string): GoldCase[] {
	const out: GoldCase[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("//")) continue;
		try {
			const c = JSON.parse(t) as GoldCase;
			if (
				typeof c.q === "string" &&
				(c.expectUrl?.length || c.expectTitle?.length || c.expect?.length)
			)
				out.push(c);
		} catch {
			/* invalid line skipped */
		}
	}
	return out;
}

/** Runs one case with the given search function. */
export async function runCase(
	c: GoldCase,
	search: (q: string) => Promise<{ results: readonly EvalHit[]; mode: string }>
): Promise<CaseResult> {
	const t0 = performance.now();
	const { results, mode } = await search(c.q);
	return {
		case: c,
		rank: firstHitRank(results, c),
		ndcg: ndcgAtK(results, c),
		top: results.slice(0, 3).map((h) => ({ title: h.title, url: h.url, kind: h.kind })),
		latencyMs: Math.round(performance.now() - t0),
		mode,
	};
}
