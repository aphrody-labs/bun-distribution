/**
 * translate-wiki-fr.ts — traduit en français tous les champs de prose du wiki
 * (`bot.*`) encore rédigés en anglais (ou autre langue).
 *
 * CONTEXTE : une grande partie des synopsis d'épisodes/films et des
 * descriptions ont été ingérés depuis des sources anglophones.
 * ~600 synopsis d'épisodes sur 605 sont en anglais — impossible à éditer à la
 * main. Ce script les détecte et les traduit vers le FR, en place.
 *
 * SOURCE DE VÉRITÉ = Postgres `bot.*` (toutes les tables ciblées sont dans
 * WIKI_EDITORIAL → le forward-sync SQLite→PG les EXCLUT, le reverse-sync
 * PG→SQLite les propage). On écrit donc côté PG, c'est sûr et propagé.
 * Après run → propager au replica SQLite :
 *   sudo systemctl start shenron-neon-pull.service
 * puis (si on veut que le RAG reflète les nouveaux textes) rebuild RAG hors
 * heures de pointe (cf. pièges CLAUDE.md).
 *
 * TRADUCTION : même cascade que le runtime `TranslateService` (Google `gtx`
 * sans clé en primaire, Lingva en repli) mais INLINE ici pour rester un script
 * ops autonome (pas de couplage DI/env du bot). Aucun champ `article` n'est
 * touché (markdown + liens [[..]] + régénéré FR par le workflow manga).
 *
 * IDEMPOTENT / REPRENABLE : on saute les lignes déjà françaises (heuristique
 * locale) et, par sécurité, on n'écrit pas si le provider détecte une source
 * `fr`. Une ligne traduite devient française → sautée au run suivant. On peut
 * donc relancer après une coupure / un rate-limit sans rien casser.
 *
 * Usage :
 *   DATABASE_URL=… bun apps/shenron/bot/scripts/translate-wiki-fr.ts [options]
 *     --dry-run            n'écrit rien ; montre ce qui serait traduit
 *     --only t1,t2         restreint aux tables (ex: --only db_episodes,db_movies)
 *     --limit N            au plus N lignes par table (test)
 *     --delay MS           throttle entre appels (défaut 800 ms, anti rate-limit)
 *     --force              traduit même si l'heuristique dit "déjà FR"
 */
import { SQL } from "bun";

// ── args ────────────────────────────────────────────────────────────────────
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
const ONLY = new Set(
	val("--only", "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
);

// ── cibles (prose, JAMAIS les colonnes `article`) ────────────────────────────
const TARGETS: { table: string; col: string }[] = [
	{ table: "db_episodes", col: "synopsis" },
	{ table: "db_movies", col: "synopsis" },
	{ table: "db_characters", col: "description" },
	{ table: "db_planets", col: "description" },
	{ table: "db_races", col: "description" },
	{ table: "db_techniques", col: "description" },
	{ table: "db_sagas", col: "description" },
	{ table: "db_arcs", col: "description" },
	{ table: "db_games", col: "description" },
	{ table: "db_tools", col: "description" },
];

// ── détection de langue (heuristique locale, FR vs reste) ────────────────────
const FR_MARKERS =
	/\b(le|la|les|un|une|des|du|de|et|est|sont|dans|qui|que|pour|avec|sur|son|sa|ses|leur|leurs|au|aux|ce|cette|ces|il|elle|ils|elles|mais|où|plus|après|contre|vers|entre|alors|lorsque|tandis|afin|ainsi|être|avoir|fait|deux|premier|première)\b/gi;
const EN_MARKERS =
	/\b(the|and|with|his|her|when|that|this|they|from|into|while|their|against|after|of|to|is|are|was|were|has|have|had|been|will|would|which|where|there|then|than|about|finally|however|episode|battle|fight|begins|defeat|power|strong|enemy)\b/gi;
const ACCENTS = /[àâäéèêëîïôöùûüçœæ]/gi;

/** true si le texte est (très probablement) déjà français. */
function looksFrench(text: string): boolean {
	const fr = (text.match(FR_MARKERS) ?? []).length + (text.match(ACCENTS) ?? []).length;
	const en = (text.match(EN_MARKERS) ?? []).length;
	// FR clair : marqueurs FR > marqueurs EN ET au moins un marqueur FR.
	return fr > en && fr > 0;
}

// ── traduction (Google gtx primaire, Lingva repli) — cf. TranslateService ─────
const GTX = "https://translate.googleapis.com/translate_a/single";
const LINGVA = [
	"https://translate.plausibility.cloud",
	"https://lingva.lunar.icu",
	"https://lingva.ml",
];
const MAX_CHARS = 4500; // < cap interne Google ; au-delà on découpe par phrase

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

/** Découpe un texte > MAX_CHARS sur les frontières de phrase/ligne. */
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

/** Traduit avec retry/backoff (Google → Lingva). Throw si tout échoue. */
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
				if (/429|403/.test(msg)) {
					// rate-limit : backoff exponentiel (1s,2s,4s,8s…) puis on tentera Lingva
					await sleep(1000 * 2 ** attempt);
				}
				if (attempt >= 2) {
					try {
						done = await lingva(piece);
					} catch {
						/* on retentera Google au tour suivant */
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

let grandTranslated = 0;
let grandSkippedFr = 0;
let grandFailed = 0;

for (const { table, col } of TARGETS) {
	if (ONLY.size && !ONLY.has(table)) continue;

	const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";
	const rows = (await sql.unsafe(
		`SELECT id, ${col} AS v FROM bot.${table}
		 WHERE ${col} IS NOT NULL AND length(btrim(${col})) > 1
		 ORDER BY id ${limitClause}`
	)) as { id: number; v: string }[];

	let translated = 0;
	let skippedFr = 0;
	let failed = 0;
	const samples: string[] = [];

	for (const r of rows) {
		const text = r.v.trim();
		if (!FORCE && looksFrench(text)) {
			skippedFr++;
			continue;
		}
		if (DRY) {
			translated++;
			if (samples.length < 3) samples.push(`#${r.id} ${JSON.stringify(text.slice(0, 80))}`);
			continue;
		}
		try {
			const { translated: fr, detected } = await translateText(text);
			// garde-fou : source déjà FR ou traduction identique → ne pas écrire
			if (detected === "fr" || fr.trim() === text) {
				skippedFr++;
			} else {
				await sql.unsafe(`UPDATE bot.${table} SET ${col} = $1 WHERE id = $2`, [fr.trim(), r.id]);
				translated++;
				if (samples.length < 3)
					samples.push(`#${r.id} [${detected}→fr] ${JSON.stringify(fr.slice(0, 80))}`);
			}
			await sleep(DELAY);
		} catch (e) {
			failed++;
			console.error(`  ✗ ${table}#${r.id}: ${(e as Error).message}`);
			await sleep(DELAY);
		}
	}

	grandTranslated += translated;
	grandSkippedFr += skippedFr;
	grandFailed += failed;
	console.log(
		`${DRY ? "[dry] " : ""}bot.${table}.${col}: ${rows.length} ligne(s) → ${translated} ${DRY ? "à traduire" : "traduite(s)"}, ${skippedFr} déjà FR, ${failed} échec(s)`
	);
	for (const s of samples) console.log(`    ${s}`);
}

console.log(
	`\n${DRY ? "[dry] " : ""}TOTAL : ${grandTranslated} ${DRY ? "à traduire" : "traduite(s)"}, ${grandSkippedFr} déjà FR, ${grandFailed} échec(s).`
);
if (!DRY && grandTranslated > 0) {
	console.log(
		"→ Propager au replica SQLite : sudo systemctl start shenron-neon-pull.service\n" +
			"→ (optionnel) rebuild RAG hors pointe pour refléter les nouveaux textes."
	);
}
await sql.end();
