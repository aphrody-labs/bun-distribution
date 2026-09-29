/**
 * clean-fullcolor-promos.ts — Retire les planches **non-contenu** des scans
 * couleur Full Color : pubs « SUSHISCAN.FR », pages de crédits staff et pages
 * blanches. C'est exactement le « renvoi sur un autre site » que l'utilisateur
 * ne veut pas voir.
 *
 * Détection conservatrice par OCR Aphrody :
 *   - pub      : texte contient « sushiscan » OU (« lisez » & « chapitres »)
 *   - crédits  : « lettering » / « translator » / « traduction » / « interior »
 *   - blanche  : image quasi uniforme blanche (mean > 250, stdev < 4)
 * + garde-fou : refuse de supprimer > 18 % d'un tome (OCR douteux → abort).
 *
 * Met à jour `bot.db_manga_chapters.pages` (reconstruit, sans renumérotation —
 * le lecteur lit le tableau, pas la continuité des noms) + `cover`, et supprime
 * les fichiers retirés du disque.
 *
 * Env requis : DATABASE_URL (Neon).
 * Usage : env DATABASE_URL=… bun scripts/clean-fullcolor-promos.ts [--dry-run]
 */
import postgres from "postgres";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { recogniseRemotePage } from "@shenron/pipeline/aphrody/remote-ocr";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const ASSETS_ROOT = join(import.meta.dir, "..", "assets");
const MAX_DROP_RATIO = 0.18;

const sql = postgres(NEON_URL, { max: 2, prepare: false });

/** Chemin DB (`./assets/...`) → chemin disque absolu. */
const toAbs = (p: string) => join(ASSETS_ROOT, p.replace(/^\.?\/*(assets\/)?/, ""));

async function ocr(absPath: string): Promise<string> {
	const png = await sharp(absPath).resize(1100).png().toBuffer();
	const result = await recogniseRemotePage(new Uint8Array(png));
	if (result.suspect || result.quality.mean_confidence < 0.8) {
		throw new Error("Aphrody OCR requires review before removing a page");
	}
	return result.text.toLowerCase().replace(/\s+/g, " ");
}

async function isBlank(absPath: string): Promise<boolean> {
	const { channels } = await sharp(absPath).stats();
	return channels.every((c) => c.mean > 250 && c.stdev < 4);
}

/** Retourne la raison du retrait, ou null si la planche est du contenu. */
async function promoReason(absPath: string): Promise<string | null> {
	if (await isBlank(absPath)) return "blanche";
	const t = await ocr(absPath);
	if (t.includes("sushiscan")) return "pub(sushiscan)";
	if (t.includes("lisez") && t.includes("chapitres")) return "pub(tagline)";
	if (/lettering|translator|traduction|cover & interior|interior design/.test(t)) return "crédits";
	return null;
}

async function main() {
	console.log(`🧹 Nettoyage promos Full Color${dryRun ? " (dry-run)" : ""}`);
	const chapters = await sql<{ id: number; title: string; pages: string[] }[]>`
		SELECT id, title, pages FROM bot.db_manga_chapters
		WHERE series='DB' AND title ILIKE 'Full Color%' AND pages IS NOT NULL
		ORDER BY chapter_number`;

	for (const ch of chapters) {
		const pages = Array.isArray(ch.pages) ? ch.pages : [];
		console.log(`\n📕 ${ch.title} (${pages.length} planches)`);
		const keep: string[] = [];
		const drop: { p: string; why: string }[] = [];
		for (const p of pages) {
			let why: string | null = null;
			try {
				why = await promoReason(toAbs(p));
			} catch (e) {
				console.warn(`   ? OCR échec ${p}: ${(e as Error).message} → gardée`);
			}
			if (why) drop.push({ p, why });
			else keep.push(p);
		}
		console.log(
			`   retirées: ${drop.length} → ${drop.map((d) => `${d.p.split("/").pop()}[${d.why}]`).join(" ")}`
		);

		if (drop.length === 0) continue;
		if (drop.length / pages.length > MAX_DROP_RATIO) {
			console.error(
				`   ⚠️ ${drop.length}/${pages.length} > ${MAX_DROP_RATIO * 100}% — abort ce tome (OCR douteux)`
			);
			continue;
		}
		if (dryRun) continue;

		for (const d of drop) {
			try {
				await unlink(toAbs(d.p));
			} catch {
				/* déjà absent */
			}
		}
		await sql`UPDATE bot.db_manga_chapters SET pages=${sql.json(keep)}, cover=${keep[0] ?? null} WHERE id=${ch.id}`;
		console.log(`   ✅ ${keep.length} planches conservées (cover ${keep[0]?.split("/").pop()})`);
	}
	console.log("\n✨ Terminé.");
	await sql.end();
}

main().catch((e) => {
	console.error("❌", e);
	process.exit(1);
});
