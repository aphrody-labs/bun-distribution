/**
 * translate-synopsis-fr.ts — traduit les synopsis d'épisodes et de films
 * vers le français et les stocke dans la colonne dédiée `synopsis_fr`.
 *
 * Contrairement à translate-wiki-fr.ts (qui écrase la colonne source),
 * ce script PRÉSERVE le synopsis original et alimente la colonne `synopsis_fr`
 * (PG `bot.db_episodes.synopsis_fr` / `bot.db_movies.synopsis_fr`).
 *
 * PRÉREQUIS : avoir appliqué la migration schema avant de lancer ce script —
 *   DATABASE_URL=... bunx drizzle-kit push --config=drizzle.config.bot.ts
 *
 * SOURCE DE VÉRITÉ = Postgres bot.* (forward-sync SQLite→PG exclut le wiki
 * éditorial ; le reverse-sync PG→SQLite propage les traductions au bot).
 * Après run, propager au replica SQLite :
 *   sudo systemctl start shenron-neon-pull.service
 *
 * TRADUCTION : cascade Google gtx (sans clé) → Lingva (repli), identique
 * au TranslateService du bot. Détecte la langue source et saute les synopsis
 * déjà rédigés en français.
 *
 * IDEMPOTENT / REPRENABLE : rows avec synopsis_fr non nul sont sautées.
 * On peut relancer après coupure sans rien casser.
 *
 * Usage :
 *   DATABASE_URL=… bun apps/bot/scripts/translate-synopsis-fr.ts [options]
 *     --dry-run            n'écrit rien, affiche les traductions candidates
 *     --only episodes|movies    restreint à une table
 *     --limit N            au plus N lignes par table
 *     --delay MS           throttle (défaut 800 ms, anti rate-limit)
 *     --force              retraduit même si synopsis_fr est déjà rempli
 */
import { SQL } from "bun";

// ── args ─────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const has = (f: string) => ARGV.includes(f);
const val = (f: string, d: string) => {
	const i = ARGV.indexOf(f);
	return i >= 0 && ARGV[i + 1] ? ARGV[i + 1]! : d;
};
const DRY = has("--dry-run");
const FORCE = has("--force");
const LIMIT = Number(val("--limit", "0")) || 0;
const DELAY = Number(val("--delay", "800")) || 800;
const ONLY = val("--only", "");

// ── détection FR (heuristique locale) ────────────────────────────────────────
const FR_MARKERS =
	/\b(le|la|les|un|une|des|du|de|et|est|sont|dans|qui|que|pour|avec|sur|son|sa|ses|leur|leurs|au|aux|ce|cette|ces|il|elle|ils|elles|mais|où|plus|après|contre|vers|entre|alors|lorsque|tandis|afin|ainsi|être|avoir|fait|deux|premier|première)\b/gi;
const EN_MARKERS =
	/\b(the|and|with|his|her|when|that|this|they|from|into|while|their|against|after|of|to|is|are|was|were|has|have|had|been|will|would|which|where|there|then|than|about|finally|however|episode|battle|fight|begins|defeat|power|strong|enemy)\b/gi;
const ACCENTS = /[àâäéèêëîïôöùûüçœæ]/gi;

function looksFrench(text: string): boolean {
	const fr = (text.match(FR_MARKERS) ?? []).length + (text.match(ACCENTS) ?? []).length;
	const en = (text.match(EN_MARKERS) ?? []).length;
	return fr > en && fr > 0;
}

// ── traduction (Google gtx → Lingva) ─────────────────────────────────────────
const GTX = "https://translate.googleapis.com/translate_a/single";
const LINGVA = [
	"https://translate.plausibility.cloud",
	"https://lingva.lunar.icu",
	"https://lingva.ml",
];
const MAX_CHARS = 4500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Tr = { translated: string; detected: string };

async function googleGtx(text: string): Promise<Tr> {
	const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "fr", dt: "t", q: text });
	const res = await fetch(`${GTX}?${params}`, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) throw new Error(`gtx HTTP ${res.status}`);
	const data = (await res.json()) as unknown[];
	if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("gtx format");
	const chunks = data[0] as Array<unknown[]>;
	const translated = chunks.map((c) => (typeof c[0] === "string" ? c[0] : "")).join("");
	if (!translated) throw new Error("gtx vide");
	const detected = typeof data[2] === "string" ? (data[2] as string).toLowerCase() : "auto";
	return { translated, detected };
}

async function lingva(text: string): Promise<Tr> {
	let last: Error | null = null;
	for (const inst of LINGVA) {
		try {
			const res = await fetch(`${inst}/api/v1/auto/fr/${encodeURIComponent(text)}`, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(8_000),
			});
			if (!res.ok) {
				last = new Error(`lingva ${inst} HTTP ${res.status}`);
				continue;
			}
			const d = (await res.json()) as { translation?: string; info?: { detectedSource?: string } };
			if (!d.translation) {
				last = new Error(`lingva ${inst} vide`);
				continue;
			}
			return {
				translated: d.translation,
				detected: (d.info?.detectedSource ?? "auto").toLowerCase(),
			};
		} catch (e) {
			last = e as Error;
		}
	}
	throw last ?? new Error("lingva indisponible");
}

function chunk(text: string): string[] {
	if (text.length <= MAX_CHARS) return [text];
	const parts: string[] = [];
	let buf = "";
	for (const seg of text.split(/(?<=[.!?。])\s+|\n+/)) {
		if ((buf + " " + seg).length > MAX_CHARS && buf) {
			parts.push(buf);
			buf = seg;
		} else {
			buf = buf ? `${buf} ${seg}` : seg;
		}
	}
	if (buf) parts.push(buf);
	return parts;
}

async function translateText(text: string): Promise<Tr> {
	const pieces = chunk(text);
	const out: string[] = [];
	let detected = "auto";
	for (const piece of pieces) {
		let done: Tr | null = null;
		for (let attempt = 0; attempt < 5 && !done; attempt++) {
			try {
				done = await googleGtx(piece);
			} catch (e) {
				const msg = (e as Error).message;
				if (/429|403/.test(msg)) await sleep(1000 * 2 ** attempt);
				if (attempt >= 2) {
					try {
						done = await lingva(piece);
					} catch {
						/* retente Google */
					}
				}
			}
		}
		if (!done) throw new Error("traduction échouée (tous providers)");
		out.push(done.translated);
		if (detected === "auto") detected = done.detected;
	}
	return { translated: out.join(" "), detected };
}

// ── main ─────────────────────────────────────────────────────────────────────
const sql = new SQL(process.env.DATABASE_URL);

const TABLES = [
	{ table: "db_episodes", col: "synopsis", colFr: "synopsis_fr", idCol: "id" },
	{ table: "db_movies", col: "synopsis", colFr: "synopsis_fr", idCol: "id" },
];

let totalTranslated = 0;
let totalSkipped = 0;
let totalFailed = 0;

for (const { table, col, colFr, idCol } of TABLES) {
	if (ONLY && !table.includes(ONLY)) continue;

	const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";
	const whereExtra = FORCE ? "" : `AND ${colFr} IS NULL`;
	const rows = (await sql.unsafe(
		`SELECT ${idCol}, ${col} FROM bot.${table} WHERE ${col} IS NOT NULL AND ${col} != '' ${whereExtra} ORDER BY ${idCol} ${limitClause}`
	)) as Array<Record<string, string>>;

	if (rows.length === 0) {
		console.log(`[${table}] Aucun synopsis à traduire.`);
		continue;
	}

	console.log(`[${table}] ${rows.length} synopsis à traduire…`);

	for (const row of rows) {
		const id = row[idCol];
		const text = row[col];
		if (!text?.trim()) {
			totalSkipped++;
			continue;
		}

		// Sauter si déjà français (sauf --force)
		if (!FORCE && looksFrench(text)) {
			if (DRY) console.log(`  [${table}#${id}] déjà FR — skip`);
			totalSkipped++;
			continue;
		}

		let result: Tr;
		try {
			result = await translateText(text);
		} catch (e) {
			console.error(`  [${table}#${id}] ECHEC : ${(e as Error).message}`);
			totalFailed++;
			continue;
		}

		// Sauter si la source est détectée comme FR (garde-fou)
		if (result.detected === "fr" && !FORCE) {
			totalSkipped++;
			continue;
		}

		const preview = result.translated.slice(0, 80).replace(/\n/g, " ");
		if (DRY) {
			console.log(`  [${table}#${id}] (${result.detected}→fr) "${preview}…"`);
			totalTranslated++;
		} else {
			await sql.unsafe(`UPDATE bot.${table} SET ${colFr} = $1 WHERE ${idCol} = $2`, [
				result.translated,
				id,
			]);
			console.log(`  ✓ [${table}#${id}] (${result.detected}→fr) "${preview}"`);
			totalTranslated++;
			await sleep(DELAY);
		}
	}
}

console.log(
	`\nTerminé — traduits: ${totalTranslated} | sautés: ${totalSkipped} | échecs: ${totalFailed}`
);
if (DRY) console.log("(--dry-run : rien n'a été écrit)");
else if (totalTranslated > 0) {
	console.log("\nPour propager au replica SQLite du bot :");
	console.log("  sudo systemctl start shenron-neon-pull.service");
}

sql.end();
