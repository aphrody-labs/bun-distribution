/**
 * Sourced illustration providers for the wiki, on top of `@shenron/images`.
 *
 * Every candidate comes from material we host — nothing is fetched, nothing is
 * generated:
 *   - xv2      : Xenoverse 2 portraits (`assets/dbz/xv2-portraits/<CODE>.png`),
 *                matched by the game's own character names (`xv2-catalog.json`).
 *   - databook : plates of `bot.db_databooks.pages` whose transcription names the
 *                entity in a heading line (name_ja exact, or the French name).
 *   - manga    : hosted scan pages (`bot.db_manga_pages` OCR) naming a technique.
 *   - anime    : `bot.db_episodes.frames` (NULL everywhere today: no offline capture).
 *
 * Used by `scripts/wiki-illustrer.ts` (batch) and `scripts/wiki-articles.ts write
 * --illustrate` (per entry, after the editorial text is written).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";
import sharp from "sharp";
import {
	dbPathToDisk,
	selectionnerIllustration,
	type AssetRoots,
	type IllustrationCandidate,
	type IllustrationEntity,
	type IllustrationProvider,
	type IllustrationSource,
	type SelectedIllustration,
} from "@shenron/images";

export const MIN_ILLUSTRATION_WIDTH = 400;

export interface IllustrationTypeDef {
	table: string;
	hasNameJa: boolean;
	sources: IllustrationSource[];
	label: string;
}

export const ILLUSTRATION_TYPES: Record<string, IllustrationTypeDef> = {
	characters: { table: "db_characters", hasNameJa: true, sources: ["xv2", "databook", "anime", "manga"], label: "personnages" },
	techniques: { table: "db_techniques", hasNameJa: true, sources: ["databook", "manga"], label: "techniques" },
	transformations: { table: "db_transformations", hasNameJa: false, sources: ["databook", "manga"], label: "transformations" },
	planets: { table: "db_planets", hasNameJa: true, sources: ["databook", "manga"], label: "planètes" },
	sagas: { table: "db_sagas", hasNameJa: true, sources: ["databook", "manga"], label: "sagas" },
};

/** `wiki-articles.ts` type names → illustration type names (same keys, arcs excluded: no image column). */
export function illustrationTypeFor(typeName: string): IllustrationTypeDef | null {
	return ILLUSTRATION_TYPES[typeName] ?? null;
}

const fold = (s: string) =>
	s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const SYN: Record<string, string> = {
	songoku: "goku", songohan: "gohan", songoten: "goten", krilin: "krillin", bills: "beerus",
	celula: "cell", majinbuu: "buu", boo: "buu", vegeto: "vegetto", msatan: "mrsatan", satan: "mrsatan",
};
const canonXv2 = (s: string) => {
	const n = s.split(/[,(]/)[0]!.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
		.replace(/^c-?(\d+)/, "android$1").replace(/[^a-z0-9]/g, "");
	return SYN[n] ?? n;
};
const headings = (text: string) =>
	text.split("\n").filter((l) => /^#{1,3}\s/.test(l)).map((l) => l.replace(/^#+\s*/, "").trim());
/** Whole-word match; short French names (< 5 letters: « Mini », « Cell ») are too ambiguous in OCR. */
const hasWord = (hay: string, needle: string) =>
	needle.length >= 5 && new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);

export interface Dims { w: number; h: number; disk: string }

export class WikiIllustrator {
	private dims = new Map<string, { w: number; h: number }>();
	private plates: { bookId: number; title: string; number: number; image: string; heads: string[]; body: string }[] | null = null;
	private mangaPages: { series: string; tome: string; planche: number; text: string }[] | null = null;
	private chapterPages: Map<string, string[]> | null = null;
	readonly providers: Record<IllustrationSource, IllustrationProvider>;

	constructor(private sql: Sql, readonly roots: AssetRoots) {
		this.providers = {
			xv2: this.xv2Provider(),
			databook: (e) => this.databookProvider(e),
			manga: (e) => this.mangaProvider(e),
			anime: async () => [],
		};
	}

	/** Preload dimensions from the inventory cache (`data/cache/assets-inventory.jsonl`). */
	async loadInventoryCache(): Promise<number> {
		const cache = Bun.file(join(this.roots.bot, "data/cache/assets-inventory.jsonl"));
		if (!(await cache.exists())) return 0;
		let n = 0;
		for (const line of (await cache.text()).split("\n")) {
			if (!line) continue;
			const e = JSON.parse(line) as { path: string; width?: number; height?: number };
			if (e.width && e.height) { this.dims.set(e.path, { w: e.width, h: e.height }); n++; }
		}
		return n;
	}

	/** Dimensions of a DB path if the file exists and decodes; null otherwise. */
	async dimsOf(dbPath: string | null | undefined): Promise<Dims | null> {
		const disk = dbPathToDisk(dbPath, this.roots);
		if (!disk || !existsSync(disk)) return null;
		const cached = this.dims.get(disk);
		if (cached) return { ...cached, disk };
		try {
			const m = await sharp(disk, { failOn: "none", limitInputPixels: false }).metadata();
			if (!m.width || !m.height) return null;
			this.dims.set(disk, { w: m.width, h: m.height });
			return { w: m.width, h: m.height, disk };
		} catch {
			return null;
		}
	}

	/** Why the current image needs replacing, or null when it is fine. */
	async needsIllustration(image: string | null | undefined): Promise<{ reason: "vide" | "fichier absent" | "basse résolution"; detail: string; lowRes: boolean } | null> {
		if (!image?.trim()) return { reason: "vide", detail: "vide", lowRes: false };
		const d = await this.dimsOf(image);
		if (!d) return { reason: "fichier absent", detail: "fichier absent", lowRes: false };
		if (d.w < MIN_ILLUSTRATION_WIDTH) return { reason: "basse résolution", detail: `${d.w}×${d.h} px`, lowRes: true };
		return null;
	}

	async pick(entite: IllustrationEntity, sources: IllustrationSource[]): Promise<SelectedIllustration | null> {
		return selectionnerIllustration({ entite, sources, providers: this.providers, minWidth: MIN_ILLUSTRATION_WIDTH });
	}

	private xv2Provider(): IllustrationProvider {
		const dir = join(this.roots.bot, "assets/dbz/xv2-portraits");
		const catalogPath = join(this.roots.bot, "assets/dbz/xv2-catalog.json");
		if (!existsSync(catalogPath)) return async () => [];
		const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { characters: Record<string, string> };
		const byName = new Map<string, string>();
		const base = (n: string) => (/[(),]/.test(n) ? 0 : 1);
		for (const [code, raw] of Object.entries(catalog.characters)) {
			if (!existsSync(join(dir, `${code}.png`))) continue;
			const k = canonXv2(raw);
			if (!k) continue;
			const cur = byName.get(k);
			if (!cur || base(raw) > base(catalog.characters[cur]!)) byName.set(k, code);
		}
		return async (e) => {
			if (e.type !== "characters") return [];
			const code = byName.get(canonXv2(e.name));
			if (!code) return [];
			const path = `./assets/dbz/xv2-portraits/${code}.png`;
			const d = await this.dimsOf(path);
			if (!d) return [];
			return [{ path, source: "xv2", provenance: `Xenoverse 2 portrait ${code} (« ${catalog.characters[code]} »)`, confidence: 1, width: d.w, height: d.h, ref: `xv2:${code}` }];
		};
	}

	private async databookProvider(e: IllustrationEntity): Promise<IllustrationCandidate[]> {
		if (!this.plates) {
			const rows = (await this.sql`
				select d.id, d.title, p->>'image' as image, (p->>'number')::int as number, p->>'text' as text
				from bot.db_databooks d, jsonb_array_elements(d.pages) p
				where d.visible and p->>'image' is not null and p->>'text' is not null`) as unknown as { id: number; title: string; image: string; number: number; text: string }[];
			this.plates = rows.map((r) => ({ bookId: r.id, title: r.title, number: r.number, image: r.image, heads: headings(r.text), body: r.text }));
		}
		const out: IllustrationCandidate[] = [];
		const ja = e.nameJa?.trim();
		const fr = fold(e.name);
		for (const p of this.plates) {
			let confidence = 0;
			let why = "";
			if (ja && ja.length >= 2 && p.heads.some((h) => h.includes(ja))) { confidence = 0.85; why = `titre « ${ja} »`; }
			else if (p.heads.some((h) => hasWord(fold(h), fr))) { confidence = 0.7; why = `titre « ${e.name} »`; }
			else if (ja && ja.length >= 3 && p.body.includes(ja)) { confidence = 0.5; why = `mention « ${ja} »`; }
			if (!confidence) continue;
			const d = await this.dimsOf(p.image);
			if (!d) continue;
			out.push({ path: p.image, source: "databook", provenance: `${p.title}, planche ${p.number} (${why})`, confidence, width: d.w, height: d.h, ref: `databook:${p.bookId}:${p.number}` });
		}
		return out;
	}

	private async mangaProvider(e: IllustrationEntity): Promise<IllustrationCandidate[]> {
		if (!this.mangaPages || !this.chapterPages) {
			this.mangaPages = (await this.sql`select series, tome, planche::int as planche, text from bot.db_manga_pages where text is not null`) as unknown as typeof this.mangaPages;
			const ch = (await this.sql`select series, chapter_number, pages from bot.db_manga_chapters where visible and pages is not null`) as unknown as { series: string; chapter_number: number; pages: string[] }[];
			this.chapterPages = new Map(ch.map((c) => [`${c.series}:${c.chapter_number}`, c.pages]));
		}
		const fr = fold(e.name);
		if (fr.length < 5) return [];
		// A name spoken in a bubble does not prove the character is drawn: 0.5 for
		// characters (reported, never applied); a technique shouted is the technique in use.
		const confidence = e.type === "techniques" ? 0.7 : 0.5;
		const out: IllustrationCandidate[] = [];
		for (const p of this.mangaPages!) {
			if (!hasWord(fold(p.text), fr)) continue;
			const tomeNo = /^(?:vol|t)(\d+)$/.exec(p.tome)?.[1];
			if (!tomeNo) continue;
			const image = this.chapterPages!.get(`${p.series}:${Number(tomeNo)}`)?.[p.planche - 1];
			if (!image) continue;
			const d = await this.dimsOf(image);
			if (!d) continue;
			out.push({ path: image, source: "manga", provenance: `Manga ${p.series} ${p.tome} planche ${p.planche} (OCR « ${e.name} »)`, confidence, width: d.w, height: d.h, ref: `manga:${p.series}:${p.tome}:${p.planche}` });
			if (out.length >= 20) break;
		}
		return out;
	}
}

const idRevision = () =>
	Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/** Writes `image` with a reversible `public.wiki_revisions` row. */
export async function applyIllustration(
	sql: Sql,
	table: string,
	id: number,
	before: string | null,
	pick: SelectedIllustration,
	editorId = "wiki-illustrer"
): Promise<void> {
	await sql.begin(async (tx) => {
		await tx.unsafe(`update bot.${table} set image = $1 where id = $2`, [pick.path, id]);
		await tx`insert into public.wiki_revisions ${tx({
			id: idRevision(),
			tableName: table,
			rowId: String(id),
			action: "update",
			label: `image: ${pick.source} — ${pick.provenance}`,
			before: tx.json({ image: before } as never),
			after: tx.json({ image: pick.path } as never),
			editorId,
			editorName: "Illustration sourcée (bibliothèque images)",
		})}`;
	});
}
