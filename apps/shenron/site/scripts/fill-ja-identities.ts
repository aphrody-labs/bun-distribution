#!/usr/bin/env bun
/**
 * Write the Japanese identity cells listed in a REVIEWED evidence file — and only
 * after re-checking each proof against its primary source.
 *
 *   bun apps/shenron/site/scripts/fill-ja-identities.ts                          # simulation (default)
 *   bun apps/shenron/site/scripts/fill-ja-identities.ts --preuves data/ja-identities-2026-09-23.json
 *   bun apps/shenron/site/scripts/fill-ja-identities.ts --appliquer
 *
 * Cells covered: `db_characters.name_ja`, `db_races.name_ja`,
 * `db_databooks.title_ja`, `db_games.title_ja`. Nothing else (never `name_romaji`:
 * no primary source prints a romanisation, transliterating is an invention).
 *
 * Doctrine (same as fill-character-identity.ts, which it complements):
 *   - Kanzenshuu and Wikipedia only PROPOSE a pairing "Latin name ↔ spelling"
 *     (`candidateSource`). They are never the proof.
 *   - The proof is a primary source that PRINTS the spelling:
 *       · `databook-planche` — a healthy planche (`defautDePlanche` null) of an
 *         official book, the spelling standing as a word (`attestedAt`). Card
 *         catalogues and magazines are refused, as in fill-character-identity.ts;
 *       · `publisher-url` — the publisher's own page (Shueisha, Bandai Namco,
 *         dragon-ball-official.com) whose text contains the spelling.
 *   - The pairing itself (this planche speaks of THIS row) is a human/agent review,
 *     recorded in `review`: a common word (シンバル, オレガノ) printed somewhere
 *     proves nothing until the excerpt ties it to the person.
 *   - A spelling already carried by another row of the table is refused: it would
 *     make the duplicate judge (doublons-personnages.ts) merge two people.
 *   - Only EMPTY cells are written; the UPDATE re-checks emptiness in SQL. Each
 *     write records one `public.wiki_revisions` row (reversible from
 *     /admin/wiki/history).
 */
import { join } from "node:path";
import postgres from "postgres";
import { defautDePlanche } from "../src/lib/databooks-defauts";
import { normaliserJa } from "../src/lib/ja/normalisation";
import { SITE_URL } from "../src/lib/config";
import { texteDePlanche, urlBase } from "./_databooks-base";
import { attestedAt } from "./_ja-attestation";

const args = process.argv.slice(2);
const opt = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : undefined;
};
const APPLY = args.includes("--appliquer");
const EVIDENCE = opt("preuves") ?? join(import.meta.dir, "..", "..", "..", "data", "ja-identities-2026-09-23.json");

/** Table → the single Japanese column this script may write, and the row's label column. */
const CELLS = {
	db_characters: { column: "name_ja", label: "name" },
	db_races: { column: "name_ja", label: "name" },
	db_databooks: { column: "title_ja", label: "title" },
	db_games: { column: "title_ja", label: "title" },
} as const;
type Table = keyof typeof CELLS;

/** Official books whose planches may prove a spelling; magazines and card lists may not. */
const REFERENCE_WORKS =
	/(daizenshuu|daizenshū|chozenshu|chōzenshū|daijiten|world guide|story guide|super exciting guide|landmark|dragon ball forever|adventure special|super history|anime illustration|complete illustration)/i;
const CARD_CATALOGUES = /\b(SDBH|DBH)\b|carddass|カードダス/i;
const MAGAZINES = new Set(["V-Jump", "Saikyō Jump", "Weekly Shonen Jump"]);

type Proof =
	| { type: "databook-planche"; databook: number; page: number; title?: string; excerpt?: string }
	| { type: "publisher-url"; url: string };

interface Entry {
	table: Table;
	id: number;
	frenchName: string;
	value: string;
	proof: Proof;
	extraProofs?: Proof[];
	candidateSource: string;
	review: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasJapanese = (s: string) => /[぀-ヿ一-鿿]/.test(s);

const evidence = JSON.parse(await Bun.file(EVIDENCE).text()) as { written?: Entry[] };
const entries = evidence.written ?? [];
console.log(`· ${entries.length} entr${entries.length > 1 ? "ies" : "y"} in ${EVIDENCE}`);

const sql = postgres(await urlBase(), { max: 2, prepare: false });
/** The DB tunnel refuses a connection now and then: retry every round-trip with backoff. */
async function retry<T>(run: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await run();
		} catch (err) {
			if (attempt >= 8) throw err;
			console.log(`  · database unreachable (${(err as Error).message}), retry ${attempt}/7`);
			await sleep(2000 * attempt);
		}
	}
}

/** Re-check one proof against its source. Returns the reason it fails, or null. */
async function checkProof(value: string, proof: Proof): Promise<string | null> {
	if (proof.type === "publisher-url") {
		const res = await fetch(proof.url, { headers: { "user-agent": `dbfr-wiki-identity/1.0 (${new URL(SITE_URL).host})` } });
		if (!res.ok) return `${proof.url} → HTTP ${res.status}`;
		const text = (await res.text()).replace(/<[^>]*>/g, " ");
		return normaliserJa(text).includes(normaliserJa(value)) ? null : `${proof.url} does not print ${value}`;
	}
	const rows = await retry(
		() => sql<{ title: string; category: string | null; page: unknown }[]>`
			SELECT d.title, d.category, p AS page
			FROM bot.db_databooks d, jsonb_array_elements(d.pages) p
			WHERE d.id = ${proof.databook} AND p->>'number' = ${String(proof.page)}`
	);
	const row = rows[0];
	if (!row) return `planche ${proof.databook}/${proof.page} not found`;
	if (CARD_CATALOGUES.test(row.title)) return `«${row.title}» is a card catalogue`;
	if (MAGAZINES.has(row.category ?? "") && !REFERENCE_WORKS.test(row.title))
		return `«${row.title}» is a magazine (${row.category})`;
	const raw = texteDePlanche(row.page);
	const defect = defautDePlanche(row.page, raw);
	if (defect) return `planche ${proof.databook}/${proof.page} is flagged «${defect}»`;
	const found = raw.includes(value) ? attestedAt(raw, value) : attestedAt(normaliserJa(raw), normaliserJa(value));
	return found === -1 ? `planche ${proof.databook}/${proof.page} does not print ${value} as a word` : null;
}

const locator = (p: Proof) =>
	p.type === "publisher-url" ? p.url : `${p.title ?? `databook ${p.databook}`} p.${p.page} (#${p.databook})`;

let written = 0;
let refused = 0;
try {
	await retry(() => sql`SELECT 1`);
	for (const e of entries) {
		const cell = CELLS[e.table];
		const tag = `${e.table}#${e.id} « ${e.frenchName} » → ${e.value}`;
		const refuse = (why: string) => {
			refused++;
			console.log(`  ✗ ${tag}: ${why}`);
		};
		if (!cell) {
			refuse("table not covered");
			continue;
		}
		if (!hasJapanese(e.value) || e.value !== e.value.trim()) {
			refuse("value is not a trimmed Japanese spelling");
			continue;
		}
		if (!e.candidateSource?.trim() || !e.review?.trim()) {
			refuse("candidateSource and review are mandatory");
			continue;
		}
		const [row] = await retry(() =>
			sql.unsafe<Record<string, unknown>[]>(
				`SELECT id::int AS id, ${cell.label} AS label, ${cell.column} AS current, visible FROM bot.${e.table} WHERE id = $1`,
				[e.id]
			)
		);
		if (!row) {
			refuse("row not found");
			continue;
		}
		if (row.visible === false) {
			refuse("row is hidden");
			continue;
		}
		if (String(row.current ?? "").trim()) {
			console.log(`  = ${tag}: already filled (${String(row.current)}), left untouched`);
			continue;
		}
		const carriedBy = await retry(() =>
			sql.unsafe<{ id: number }[]>(
				`SELECT id::int AS id FROM bot.${e.table} WHERE id <> $1 AND visible IS NOT FALSE AND btrim(${cell.column}) = $2`,
				[e.id, e.value]
			)
		);
		if (carriedBy.length) {
			refuse(`spelling already carried by row(s) ${carriedBy.map((r) => r.id).join(", ")}`);
			continue;
		}
		// The main proof must hold; extra proofs only reinforce it and are reported.
		const mainFails = await checkProof(e.value, e.proof);
		if (mainFails) {
			refuse(`main proof fails: ${mainFails}`);
			continue;
		}
		const failures: string[] = [];
		for (const p of e.extraProofs ?? []) {
			const why = await checkProof(e.value, p);
			if (why) failures.push(why);
		}
		console.log(
			`  ✓ ${tag} — ${locator(e.proof)}${failures.length ? ` (extra proofs not re-verified: ${failures.join("; ")})` : ""}`
		);
		if (!APPLY) continue;
		await retry(() =>
			sql.begin(async (tx) => {
				const done = await tx.unsafe(
					`UPDATE bot.${e.table} SET ${cell.column} = $1 WHERE id = $2 AND coalesce(btrim(${cell.column}), '') = '' RETURNING id`,
					[e.value, e.id]
				);
				if (done.length === 0) return;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: crypto.randomUUID(),
					tableName: e.table,
					rowId: String(e.id),
					action: "update",
					label: String(row.label ?? e.frenchName),
					before: tx.json({ [cell.column]: row.current == null ? null : String(row.current) }),
					after: tx.json({ [cell.column]: e.value }),
					editorId: "agent",
					editorName: `Agent dbfr-wiki (fill-ja-identities: ${locator(e.proof)})`.slice(0, 480),
				})}`;
				written++;
			})
		);
	}
	console.log(
		APPLY
			? `\n✓ ${written} cell(s) written, one revision each; ${refused} refused.`
			: `\nSimulation: ${refused} refused. To write: --appliquer`
	);
} finally {
	await sql.end();
}
