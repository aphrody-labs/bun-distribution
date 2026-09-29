/**
 * Fills `name_ja` and `name_romaji` of canonical techniques — after verification.
 *
 *   bun apps/shenron/site/scripts/ja-techniques.ts            # simulation (default)
 *   bun apps/shenron/site/scripts/ja-techniques.ts --apply    # writes, one revision per row
 *
 * History: the first version matched French names against a hard-coded list and
 * wrote without revision. Measured on 2026-09-12 it left 98 % of `name_ja` empty
 * for one reason: the base names are game-localisation labels ("Morsure du
 * soleil", "Technique du loup", "Attaque volley-ball"), so a name match found
 * nothing — or found the wrong row ("Attaque Garric" is the Xenoverse variant
 * of the Galick Gun, not the manga technique). The table now lives in
 * `_technique-lexicon.ts`, keyed by id with a name guard.
 *
 * What is checked before anything is written:
 * - name_ja: the headword appears on a sound planche of a technique dictionary
 *   (Daizenshuu 7, Chōzenshū 4 or the Super Exciting Guide skill pages).
 * - name_romaji: derived by modified Hepburn from a kana reading that is either
 *   the headword itself (pure kana) or attested in the kana of a sound planche
 *   anywhere in the corpus (furigana included). No attested reading, no romaji:
 *   どどん波 or 排球拳 are not romanised from memory.
 * - only empty columns are written (`name_ja IS NULL OR name_ja = ''`), and the
 *   row's name must still equal the lexicon's guard.
 */
import postgres from "postgres";
import { defautDePlanche } from "../src/lib/databooks-defauts";
import { urlBase } from "./_databooks-base";
import {
	BOOK_LABELS,
	DICTIONARY_PAGES,
	TECHNIQUES,
	kanaProjection,
	normalizeForQuote,
	toHepburn,
	toHiragana,
} from "./_technique-lexicon";

const APPLY = process.argv.includes("--apply");
const EDITOR = { id: "agent", name: "Agent dbfr-wiki (sources manga + databooks)" };

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const jsonb = (value: unknown) => sql.json(value as Parameters<typeof sql.json>[0]);
const revisionId = () =>
	Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

type Page = { book: number; page: number; text: string; tokens: string[] };

/**
 * Kana tokens of a planche, folded to hiragana. The text is cut on whitespace
 * and on every sign that is neither kana nor kanji, THEN kanji are removed
 * inside each token (furigana interleaved with their kanji become contiguous).
 * Cutting first matters: a plain kana projection glued 「しません。こういう」
 * into a false 「ませんこう」 (Masenkō) on a drawing lesson of databook 92.
 */
function kanaTokens(text: string): string[] {
	return text
		.normalize("NFC")
		.split(/[^ぁ-ゖァ-ヺー一-龯々〆]+/u)
		.map((t) => kanaProjection(t))
		.filter(Boolean);
}

try {
	const rows = await sql<{ id: number; pages: unknown }[]>`
		SELECT id, pages FROM bot.db_databooks WHERE jsonb_typeof(pages) = 'array'`;
	const sound: Page[] = [];
	for (const r of rows) {
		for (const p of r.pages as Record<string, unknown>[]) {
			const text = typeof p.text === "string" ? p.text : "";
			if (!text.trim() || defautDePlanche(p, text)) continue;
			sound.push({ book: Number(r.id), page: Number(p.number ?? 0), text, tokens: kanaTokens(text) });
		}
	}
	const dictionary = sound.filter((p) =>
		DICTIONARY_PAGES.some((d) => d.book === p.book && p.page >= d.from && p.page <= d.to)
	);
	console.log(`corpus : ${sound.length} planches saines, dont ${dictionary.length} de dictionnaires de techniques\n`);

	const current = await sql<{ id: number; name: string; name_ja: string | null; name_romaji: string | null }[]>`
		SELECT id, name, name_ja, name_romaji FROM bot.db_techniques WHERE id IN ${sql(TECHNIQUES.map((t) => t.id))}`;
	const byId = new Map(current.map((r) => [Number(r.id), r]));

	const plan: { id: number; name: string; set: Record<string, string>; before: Record<string, string | null>; why: string[] }[] = [];
	const refused: string[] = [];

	for (const t of TECHNIQUES) {
		const row = byId.get(t.id);
		if (!row) {
			refused.push(`#${t.id} ${t.name} : ligne absente`);
			continue;
		}
		if (row.name.normalize("NFC") !== t.name.normalize("NFC")) {
			refused.push(`#${t.id} : nom en base « ${row.name} » ≠ garde « ${t.name} »`);
			continue;
		}
		const set: Record<string, string> = {};
		const before: Record<string, string | null> = {};
		const why: string[] = [];

		const headword = normalizeForQuote(t.ja);
		const dictHits = dictionary.filter((p) => normalizeForQuote(p.text).includes(headword));
		if (dictHits.length === 0) {
			refused.push(`#${t.id} ${t.name} : « ${t.ja} » absent des dictionnaires de techniques`);
			continue;
		}
		const jaInBase = (row.name_ja ?? "").trim();
		if (!jaInBase) {
			set.name_ja = t.ja;
			before.name_ja = row.name_ja;
			why.push(
				`name_ja ${t.ja} : ${dictHits
					.slice(0, 3)
					.map((p) => `${BOOK_LABELS[p.book] ?? `databook ${p.book}`} pl.${p.page}`)
					.join(" ; ")}`
			);
		} else if (jaInBase !== t.ja) {
			refused.push(`#${t.id} ${t.name} : name_ja en base « ${jaInBase} » ≠ lexique « ${t.ja} » (non touché)`);
		}

		const effectiveJa = jaInBase || t.ja;
		if (t.reading && !(row.name_romaji ?? "").trim() && effectiveJa === t.ja) {
			const readingKana = toHiragana(t.reading.replace(/\s+/g, ""));
			const pureKana = /^[ぁ-ゖァ-ヺー]+$/.test(t.ja);
			if (pureKana && toHiragana(t.ja) !== readingKana) {
				refused.push(`#${t.id} ${t.name} : lecture « ${t.reading} » ≠ graphie « ${t.ja} »`);
			} else {
				// A reading is attested by a whole kana token, or by a token containing it on a
				// planche that also writes the headword (furigana run into a longer gloss).
				const attest = pureKana
					? null
					: (sound.find((p) => p.tokens.includes(readingKana)) ??
						sound.find(
							(p) => p.tokens.some((tok) => tok.includes(readingKana)) && normalizeForQuote(p.text).includes(headword)
						));
				if (!pureKana && !attest) {
					refused.push(`#${t.id} ${t.name} : lecture « ${t.reading} » non attestée dans le corpus`);
				} else {
					set.name_romaji = toHepburn(t.reading);
					before.name_romaji = row.name_romaji;
					why.push(
						`name_romaji ${set.name_romaji} : ${
							attest
								? `lecture ${readingKana} attestée (${BOOK_LABELS[attest.book] ?? `databook ${attest.book}`} pl.${attest.page})`
								: "graphie en kana"
						}`
					);
				}
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
		console.log(`\n— ${refused.length} écartées ou partielles —`);
		for (const r of refused) console.log(`  ${r}`);
	}

	if (!APPLY) {
		console.log("\nSimulation. Relancer avec --apply pour écrire.");
	} else {
		let written = 0;
		for (const p of plan) {
			await sql.begin(async (tx) => {
				const done: Record<string, string> = {};
				for (const [col, value] of Object.entries(p.set)) {
					const res = await tx.unsafe(
						`UPDATE bot.db_techniques SET ${col} = $1 WHERE id = $2 AND (${col} IS NULL OR btrim(${col}) = '')`,
						[value, p.id]
					);
					if (res.count === 1) done[col] = value;
				}
				if (Object.keys(done).length === 0) return;
				const before = Object.fromEntries(Object.keys(done).map((k) => [k, p.before[k] ?? null]));
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: revisionId(),
					tableName: "db_techniques",
					rowId: String(p.id),
					action: "update",
					label: `${p.name} — ${p.why.join(" | ")}`.slice(0, 1000),
					before: jsonb(before),
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
