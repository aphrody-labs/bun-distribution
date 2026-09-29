/**
 * enrich-games-desc.ts — Remplit `bot.db_games.description` dans **Neon**
 * (source de vérité éditoriale) depuis l'API REST de Wikipédia (FR d'abord,
 * fallback EN), qui renvoie un extrait « lead » propre en texte.
 *
 * Pourquoi Neon : `db_games` est une table du wiki éditorial (cf.
 * _wiki-editorial.ts) ; le reverse-sync Neon→SQLite écrase SQLite. On écrit
 * dans Neon, le site lit Neon en direct, le bot reçoit au prochain pull.
 *
 * Source : Wikipédia (CC BY-SA) — attribution ajoutée en fin de description.
 * Garde qualité : on n'écrit que les pages `type=standard` (pas les
 * homonymies / pages absentes) dont l'extrait mentionne « Dragon Ball » et
 * dépasse 80 caractères → pas d'injection de texte hors-sujet. Idempotent :
 * ne traite que les jeux à description vide.
 *
 * Env requis : DATABASE_URL (Neon, via /home/ubuntu/.shenron-neon.env).
 * Env optionnel : LIMIT=5.
 *
 * Usage : via systemd-run avec EnvironmentFile (cf. enrich-episode-synopsis.ts).
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis dans l'environnement.");
	process.exit(1);
}

const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Number.POSITIVE_INFINITY;

// Titres Wikipédia divergents du titre DB (sous-titres stockés en court côté
// DB). La garde (type=standard + mention « Dragon Ball ») rejette tout mauvais
// mapping → un override erroné est simplement ignoré, jamais écrit.
const OVERRIDES: Record<string, string> = {
	"Dragon Ball Z Dokkan Battle": "Dragon Ball Z: Dokkan Battle",
	"Super Dragon Ball Heroes World Mission": "Super Dragon Ball Heroes: World Mission",
	"Super Butōden 2": "Dragon Ball Z: Super Butōden 2",
	"Super Butōden 3": "Dragon Ball Z: Super Butōden 3",
	"Shin Butōden": "Dragon Ball Z: Shin Butōden",
	"Ultimate Butōden": "Dragon Ball Z: Ultimate Butōden",
	"Extreme Butōden": "Dragon Ball Z: Extreme Butōden",
	"Idainaru Son Goku Densetsu": "Dragon Ball: Idainaru Son Goku Densetsu",
	"Idainaru Dragon Ball Densetsu": "Dragon Ball Z: Idainaru Dragon Ball Densetsu",
	Origins: "Dragon Ball: Origins",
	"Origins 2": "Dragon Ball: Origins 2",
	"The Legacy of Goku": "Dragon Ball Z: The Legacy of Goku",
	"Side Story: Plan to Eradicate the Saiyans": "Dragon Ball Z: Plan to Eradicate the Saiyans",
	"Buyū Retsuden": "Dragon Ball Z: Buyū Retsuden",
	"Hyper Dimension": "Dragon Ball Z: Hyper Dimension",
	"Legendary Super Warriors": "Dragon Ball Z: Legendary Super Warriors",
	Taiketsu: "Dragon Ball Z: Taiketsu",
	"Advanced Adventure": "Dragon Ball: Advanced Adventure",
	Sagas: "Dragon Ball Z: Sagas",
	Transformation: "Dragon Ball GT: Transformation",
	"Revenge of King Piccolo": "Dragon Ball: Revenge of King Piccolo",
	Evolution: "Dragon Ball: Evolution (video game)",
	Online: "Dragon Ball Online",
	"For Kinect": "Dragon Ball Z for Kinect",
	Fusions: "Dragon Ball Fusions",
	"Famicom Jump: Hero Retsuden": "Famicom Jump: Hero Retsuden",
	"Famicom Jump II: Saikyō no Shichinin": "Famicom Jump II: Saikyō no Shichinin",
	"Jump Super Stars": "Jump Super Stars",
	"Jump Ultimate Stars": "Jump Ultimate Stars",
	"J-Stars Victory VS": "J-Stars Victory Vs",
	"Jump Force": "Jump Force",
};

// Jeux crossover (Shōnen Jump) : page Wikipédia exacte et fiable, mais leur
// chapeau ne cite pas toujours « Dragon Ball » littéralement → on lève la garde
// de mention DB pour ces titres précis (le mapping est sûr).
const CROSSOVER = new Set([
	"Jump Super Stars",
	"Jump Ultimate Stars",
	"J-Stars Victory VS",
	"Jump Force",
	"Famicom Jump: Hero Retsuden",
]);

const UA = "DBFR-wiki-enrichment/1.0 (https://dragonballfr.com; wiki Dragon Ball France)";
const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Summary = { type?: string; title?: string; extract?: string };

async function wikiSummary(
	lang: string,
	title: string,
	requireDbMention: boolean
): Promise<string | null> {
	const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
	try {
		const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
		if (!res.ok) return null;
		const d = (await res.json()) as Summary;
		if (d.type !== "standard") return null; // homonymie / absente / erreur → skip
		const ex = (d.extract ?? "").trim();
		if (ex.length < 80) return null;
		if (requireDbMention && !/dragon\s*ball/i.test(ex)) return null; // garde hors-sujet
		return ex;
	} catch {
		return null;
	}
}

type Game = { id: number; title: string };

const games = (await sql`
	SELECT id, title FROM bot.db_games
	WHERE (description IS NULL OR description = '')
	ORDER BY id
`) as unknown as Game[];

console.log(`→ ${games.length} jeu(x) sans description`);

let updated = 0;
const skipped: string[] = [];
let processed = 0;

for (const g of games) {
	if (processed >= LIMIT) break;
	processed++;
	const lookup = OVERRIDES[g.title] ?? g.title;
	const requireDb = !CROSSOVER.has(g.title);
	const fr = await wikiSummary("fr", lookup, requireDb);
	await sleep(300);
	let text = fr;
	let lang = "Wikipédia (fr)";
	if (!text) {
		text = await wikiSummary("en", lookup, requireDb);
		lang = "Wikipedia (en)";
		await sleep(300);
	}
	if (text) {
		const body = `${text}\n\n_(Source : ${lang}, CC BY-SA.)_`;
		await sql`UPDATE bot.db_games SET description = ${body} WHERE id = ${g.id}`;
		updated++;
		console.log(`  ✓ ${g.title}`);
	} else {
		skipped.push(g.title);
	}
}

console.log(`✓ Terminé : ${updated} description(s) écrite(s).`);
if (skipped.length) {
	console.log(`⚠ ${skipped.length} non résolu(s) (à compléter à la main / OVERRIDES) :`);
	for (const s of skipped) console.log(`   - ${s}`);
}
await sql.end();
