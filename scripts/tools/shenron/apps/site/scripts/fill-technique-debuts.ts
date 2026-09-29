/**
 * Fills `debut_chapter_id` and `creator_id` of canonical techniques from the
 * databooks — after re-reading every cited planche.
 *
 *   bun apps/site/scripts/fill-technique-debuts.ts            # simulation (default)
 *   bun apps/site/scripts/fill-technique-debuts.ts --apply    # writes, one revision per row
 *
 * Values and their evidence live in `_technique-lexicon.ts`. This script trusts
 * none of them blindly:
 * - each `quote` evidence must be found in the whitespace-stripped transcription
 *   of the cited planche, and that planche must be sound (`defautDePlanche`);
 * - each `scan` evidence must point to a planche whose image exists on disk
 *   (the value was read on the image because the transcription is wrong);
 * - a `manga` evidence must be found on the cited planche of `bot.db_manga_pages`;
 * - a debut chapter needs ≥ 2 valid evidences from ≥ 2 different sources (each
 *   databook, or the manga), and is
 *   resolved to the visible DBFC chapter with that number (tankōbon 其之N);
 * - a creator needs ≥ 1 valid evidence and a visible `db_characters` row.
 *
 * `debut_episode_id` is not handled: no databook of the corpus gives technique
 * debuts by TV episode, and the anime is not a source by itself.
 *
 * Only NULL columns are written; the row's name must still equal the guard.
 */
import { existsSync } from "node:fs";
import postgres from "postgres";
import { defautDePlanche } from "../src/lib/databooks-defauts";
import { cheminPlanche, urlBase } from "./_databooks-base";
import { BOOK_LABELS, DIVERGENCES, type Evidence, TECHNIQUES, normalizeForQuote } from "./_technique-lexicon";

const APPLY = process.argv.includes("--apply");
const EDITOR = { id: "agent", name: "Agent dbfr-wiki (sources manga + databooks)" };

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const jsonb = (value: unknown) => sql.json(value as Parameters<typeof sql.json>[0]);
const revisionId = () =>
	Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

const allEvidence = TECHNIQUES.flatMap((t) => [...(t.debutChapter?.evidence ?? []), ...(t.creator?.evidence ?? [])]);
const books = [...new Set(allEvidence.flatMap((e) => ("book" in e ? [e.book] : [])))];
const tomes = [...new Set(allEvidence.flatMap((e) => ("manga" in e ? [e.manga] : [])))];
/** Source key used to count independent books: databook id, or the manga as a whole. */
const sourceKey = (e: Evidence) => ("manga" in e ? "manga" : `databook:${e.book}`);

try {
	const rows = await sql<{ id: number; pages: unknown }[]>`
		SELECT id, pages FROM bot.db_databooks WHERE id IN ${sql(books)} AND jsonb_typeof(pages) = 'array'`;
	const planches = new Map<string, Record<string, unknown>>();
	for (const r of rows)
		for (const p of r.pages as Record<string, unknown>[]) planches.set(`${r.id}/${Number(p.number)}`, p);

	const mangaRows = tomes.length
		? await sql<{ tome: string; planche: number; text: string | null }[]>`
			SELECT tome, planche, text FROM bot.db_manga_pages WHERE series = 'DB' AND tome IN ${sql(tomes)}`
		: [];
	const mangaPages = new Map(mangaRows.map((m) => [`${m.tome}/${Number(m.planche)}`, m.text ?? ""]));

	/** `null` when the evidence holds, else the reason it does not. */
	const check = (e: Evidence): string | null => {
		if ("manga" in e) {
			const text = mangaPages.get(`${e.manga}/${e.page}`);
			if (text === undefined) return `planche manga ${e.manga}/${e.page} introuvable`;
			return normalizeForQuote(text).includes(normalizeForQuote(e.quote))
				? null
				: `extrait « ${e.quote} » introuvable sur manga ${e.manga}/${e.page}`;
		}
		const p = planches.get(`${e.book}/${e.page}`);
		if (!p) return `planche ${e.book}/${e.page} introuvable`;
		if ("scan" in e) {
			const path = cheminPlanche(typeof p.image === "string" ? p.image : null);
			return path && existsSync(path) ? null : `scan ${e.book}/${e.page} absent du disque`;
		}
		const text = typeof p.text === "string" ? p.text : "";
		const defaut = defautDePlanche(p, text);
		if (defaut) return `planche ${e.book}/${e.page} jugée fautive (${defaut})`;
		return normalizeForQuote(text).includes(normalizeForQuote(e.quote))
			? null
			: `extrait « ${e.quote} » introuvable sur ${e.book}/${e.page}`;
	};
	const cite = (e: Evidence) =>
		"manga" in e
			? `Manga Dragon Ball ${e.manga.replace("vol", "tome ")}, planche ${e.page} : ${e.quote}`
			: `${BOOK_LABELS[e.book] ?? `databook ${e.book}`} pl.${e.page} : ${"scan" in e ? e.scan : e.quote}`;

	const current = await sql<{ id: number; name: string; debut_chapter_id: number | null; creator_id: number | null }[]>`
		SELECT id, name, debut_chapter_id, creator_id FROM bot.db_techniques WHERE id IN ${sql(TECHNIQUES.map((t) => t.id))}`;
	const byId = new Map(current.map((r) => [Number(r.id), r]));
	const chapters = await sql<{ id: number; chapter_number: number; title: string | null }[]>`
		SELECT id, chapter_number, title FROM bot.db_manga_chapters WHERE series = 'DBFC' AND visible`;
	const chapterByNumber = new Map(chapters.map((c) => [Number(c.chapter_number), c]));

	const plan: { id: number; name: string; set: Record<string, number>; before: Record<string, number | null>; why: string[] }[] = [];
	const refused: string[] = [];

	for (const t of TECHNIQUES) {
		if (!t.debutChapter && !t.creator) continue;
		const row = byId.get(t.id);
		if (!row || row.name.normalize("NFC") !== t.name.normalize("NFC")) {
			refused.push(`#${t.id} ${t.name} : ligne absente ou renommée`);
			continue;
		}
		const set: Record<string, number> = {};
		const before: Record<string, number | null> = {};
		const why: string[] = [];

		if (t.debutChapter && row.debut_chapter_id === null) {
			const failures = t.debutChapter.evidence.map((e) => [e, check(e)] as const);
			const valid = failures.filter(([, f]) => f === null).map(([e]) => e);
			for (const [, f] of failures) if (f) refused.push(`#${t.id} ${t.name} : ${f}`);
			const chapter = chapterByNumber.get(t.debutChapter.number);
			if (new Set(valid.map(sourceKey)).size < 2) {
				refused.push(`#${t.id} ${t.name} : chapitre ${t.debutChapter.number} — moins de deux ouvrages concordants`);
			} else if (!chapter) {
				refused.push(`#${t.id} ${t.name} : chapitre DBFC ${t.debutChapter.number} absent`);
			} else {
				set.debut_chapter_id = Number(chapter.id);
				before.debut_chapter_id = row.debut_chapter_id;
				why.push(
					`debut_chapter_id → chapitre ${chapter.chapter_number} « ${chapter.title ?? ""} » (${valid.map(cite).join(" ; ")})`
				);
			}
		}

		if (t.creator && row.creator_id === null) {
			const valid = t.creator.evidence.filter((e) => {
				const f = check(e);
				if (f) refused.push(`#${t.id} ${t.name} : ${f}`);
				return f === null;
			});
			const [character] = await sql<{ id: number; name: string; visible: boolean }[]>`
				SELECT id, name, visible FROM bot.db_characters WHERE id = ${t.creator.characterId}`;
			if (valid.length === 0) {
				refused.push(`#${t.id} ${t.name} : créateur sans preuve valide`);
			} else if (!character?.visible) {
				refused.push(`#${t.id} ${t.name} : personnage #${t.creator.characterId} absent ou masqué`);
			} else {
				set.creator_id = Number(character.id);
				before.creator_id = row.creator_id;
				why.push(`creator_id → #${character.id} ${character.name} (${valid.map(cite).join(" ; ")})`);
			}
		}
		if (Object.keys(set).length > 0) plan.push({ id: t.id, name: row.name, set, before, why });
	}

	console.log(`— ${plan.length} fiches à compléter —`);
	for (const p of plan) {
		console.log(`#${p.id} « ${p.name} »`);
		for (const w of p.why) console.log(`    ${w}`);
	}
	if (refused.length > 0) {
		console.log(`\n— ${refused.length} refus —`);
		for (const r of refused) console.log(`  ${r}`);
	}
	console.log(`\n— divergences documentées (non écrites) —`);
	for (const d of DIVERGENCES) console.log(`  #${d.id} ${d.note}`);

	if (!APPLY) {
		console.log("\nSimulation. Relancer avec --apply pour écrire.");
	} else {
		let written = 0;
		for (const p of plan) {
			await sql.begin(async (tx) => {
				const done: Record<string, number> = {};
				for (const [col, value] of Object.entries(p.set)) {
					const res = await tx.unsafe(
						`UPDATE bot.db_techniques SET ${col} = $1 WHERE id = $2 AND ${col} IS NULL`,
						[value, p.id]
					);
					if (res.count === 1) done[col] = value;
				}
				if (Object.keys(done).length === 0) return;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: revisionId(),
					tableName: "db_techniques",
					rowId: String(p.id),
					action: "update",
					label: `${p.name} — ${p.why.join(" | ")}`.slice(0, 1500),
					before: jsonb(Object.fromEntries(Object.keys(done).map((k) => [k, p.before[k] ?? null]))),
					after: jsonb(done),
					editorId: EDITOR.id,
					editorName: EDITOR.name,
				})}`;
				written++;
			});
		}
		console.log(`\n✔ ${written} fiches écrites, une révision chacune.`);
	}
} finally {
	await sql.end();
}
