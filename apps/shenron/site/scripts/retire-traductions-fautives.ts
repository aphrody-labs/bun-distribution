#!/usr/bin/env bun
/**
 * Retire les traductions FR posées sur des transcriptions databook fautives.
 * Simulation par défaut ; --appliquer écrit une révision réversible.
 */
import postgres from "postgres";
import { arretSiGel, chargeOuvrages, traductionDePlanche, texteDePlanche, urlBase } from "./_databooks-base";
import { defautDePlanche } from "../src/lib/databooks-defauts";

const apply = process.argv.includes("--appliquer");
arretSiGel("retire-traductions-fautives");
const revisionId = () => Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]!).join("");

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {

	const ouvrages = await chargeOuvrages(sql);
	const cibles: { book: number; title: string | null; page: number; index: number; fr: string; reason: string }[] = [];
	for (const book of ouvrages) {
		for (let index = 0; index < book.pages.length; index++) {
			const page = book.pages[index]!;
			const ja = texteDePlanche(page).trim();
			const fr = traductionDePlanche(page).trim();
			const reason = fr && !ja
				? "traduction sans source japonaise"
				: ja && fr
					? defautDePlanche(page, ja)
					: null;
			if (fr && reason) cibles.push({ book: book.id, title: book.title, page: Number(page.number) || index + 1, index, fr, reason });
		}
	}
	console.log(`${cibles.length} traduction(s) fautive(s) détectée(s).`);
	for (const c of cibles) console.log(`  #${c.book} ${c.title} p${c.page} — ${c.reason}`);
	if (!apply || cibles.length === 0) {
		console.log(apply ? "Rien à retirer." : "Simulation — relancer avec --appliquer pour retirer.");
		process.exit(0);
	}

	const byBook = new Map<number, typeof cibles>();
	for (const c of cibles) byBook.set(c.book, [...(byBook.get(c.book) ?? []), c]);
	for (const [book, pages] of byBook) {
		await sql.begin(async (tx) => {
			const [row] = await tx<{ pages: Record<string, unknown>[] | null }[]>`SELECT pages FROM bot.db_databooks WHERE id = ${book} FOR UPDATE`;
			if (!row?.pages) return;
			const before: Record<string, unknown> = {};
			const after: Record<string, unknown> = {};
			const positions = new Map(row.pages.map((p, i) => [Number(p.number), i] as const));
			for (const c of pages) {
				const index = positions.get(c.page);
				if (index === undefined) continue;
				before[`traduction#${c.page}`] = row.pages[index]?.text_fr ?? null;
				after[`traduction#${c.page}`] = null;
				await tx`UPDATE bot.db_databooks SET pages = jsonb_set(pages, ${`{${index}}`}::text[], (pages->${index}::int) - 'text_fr' - 'text_fr_by' - 'text_fr_at', true) WHERE id = ${book}`;
			}
			await tx`INSERT INTO public.wiki_revisions ${tx({ id: revisionId(), tableName: "db_databooks", rowId: String(book), action: "update", label: `Retrait de ${pages.length} traduction(s) sur transcriptions fautives`, before: tx.json(before as any), after: tx.json(after as any), editorId: "agent", editorName: "Shenron quality gate" })}`;
		});
	}
	console.log(`✔ ${cibles.length} traduction(s) retirée(s) et versionnée(s).`);
} finally {
	await sql.end();
}
