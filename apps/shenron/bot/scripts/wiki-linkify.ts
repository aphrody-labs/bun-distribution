/**
 * wiki-linkify.ts — Tisse les LIENS INTERNES entre articles wiki (wiki « vivant »).
 *
 * Passe DÉTERMINISTE (zéro LLM) : pour chaque article rédigé, repère les mentions
 * d'AUTRES entités (personnages, planètes, sagas, arcs, races, techniques) et
 * enveloppe leur PREMIÈRE occurrence dans un lien markdown interne
 * `[Nom](/wiki/...)`. Idempotent : ne re-linke jamais un texte déjà dans un lien,
 * un titre `#`, ou du code inline. Écrit la colonne `article` en PG (source de
 * vérité ; le reverse-sync propage au SQLite).
 *
 * Garde-fous anti-bruit :
 *  - nom ≥ 4 lettres ; on ne linke QUE si la casse du texte trouvé est un nom
 *    propre (1re lettre majuscule) → évite « table » → entité « Table » ;
 *  - alternation triée par longueur décroissante (« Tortue Géniale » avant « Tortue ») ;
 *  - une entité = un seul lien par article (1re occurrence) ; jamais l'entité elle-même ;
 *  - bornes de mots Unicode (accents gérés) via lookarounds \p{L}\p{N}.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/wiki-linkify.ts                 # dry-run global (stats)
 *   bun apps/shenron/bot/scripts/wiki-linkify.ts --apply         # écrit PG (tous types)
 *   ... [--type characters] [--ids 1,2] [--limit N]
 *
 * Env : DATABASE_URL = PG du site.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("✗ DATABASE_URL requis.");
	process.exit(1);
}

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const opt = (f: string) => {
	const i = argv.indexOf(f);
	return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = has("--apply");
const ONLY_TYPE = opt("--type");
const IDS = opt("--ids")
	?.split(",")
	.map((s) => Number(s.trim()))
	.filter((n) => !isNaN(n));
const LIMIT = opt("--limit") ? Number(opt("--limit")) : Infinity;

// Type d'entité → table + builder d'URL de DÉTAIL sur le site.
type Kind = "characters" | "planets" | "sagas" | "arcs" | "races" | "techniques";
const KINDS: Record<Kind, { table: string; url: (r: Row) => string }> = {
	characters: { table: "db_characters", url: (r) => `/wiki/dragon-ball/character/${r.id}` },
	planets: { table: "db_planets", url: (r) => `/wiki/dragon-ball/planet/${r.id}` },
	sagas: { table: "db_sagas", url: (r) => `/wiki/sagas/${r.slug}` },
	arcs: { table: "db_arcs", url: (r) => `/wiki/arcs/${r.slug}` },
	races: { table: "db_races", url: (r) => `/wiki/races/${r.slug}` },
	techniques: { table: "db_techniques", url: (r) => `/wiki/dragon-ball/techniques/${r.slug}` },
};

interface Row {
	id: number;
	name: string;
	slug?: string;
	has_article?: boolean;
}
interface Target {
	key: string; // nom normalisé (lowercase)
	name: string; // nom d'affichage
	url: string;
	kind: Kind;
	id: number;
	hasArticle: boolean;
}

/** Clé canonique : on retire l'honorifique « Son » (Son Goku ≡ Goku) sans toucher
 * aux titres distinctifs (Roi Vegeta ≠ Vegeta). */
function canonKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/^son\s+/, "")
		.trim();
}

const pg = postgres(DATABASE_URL, { max: 1, prepare: false });

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Charge toutes les cibles liables (entités à URL de détail). */
async function loadTargets(): Promise<Target[]> {
	const out: Target[] = [];
	for (const [kind, cfg] of Object.entries(KINDS) as [Kind, (typeof KINDS)[Kind]][]) {
		const slugCol = ["sagas", "arcs", "races", "techniques"].includes(kind) ? ", slug" : "";
		const rows = (await pg.unsafe(
			`SELECT id, name${slugCol}, (article IS NOT NULL AND length(article) > 0) AS has_article FROM bot.${cfg.table}`
		)) as unknown as Row[];
		for (const r of rows) {
			const name = (r.name ?? "").trim();
			if (name.length < 4) continue; // anti-bruit
			if (
				(kind === "sagas" || kind === "arcs" || kind === "races" || kind === "techniques") &&
				!r.slug
			)
				continue;
			out.push({
				key: name.toLowerCase(),
				name,
				url: cfg.url(r),
				kind,
				id: r.id,
				hasArticle: !!r.has_article,
			});
		}
	}
	return out;
}

/**
 * Linkifie un article. `self` = clé {kind,id} de l'entité de l'article (jamais liée).
 * Retourne [nouveauTexte, nbLiens].
 */
function linkify(
	article: string,
	targets: Target[],
	byKey: Map<string, Target>,
	selfKind: Kind,
	selfId: number,
	selfName: string
): [string, number] {
	const selfCanon = canonKey(selfName); // « Son Goku » sur la page « Goku » → exclu
	// Alternation triée par longueur de nom décroissante (greedy le plus spécifique).
	const sorted = [...targets].toSorted((a, b) => b.name.length - a.name.length);
	const alt = sorted.map((t) => escapeRe(t.name)).join("|");
	if (!alt) return [article, 0];
	// Bornes de mots Unicode : pas de lettre/chiffre adjacent.
	const re = new RegExp(`(?<![\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, "giu");

	const used = new Set<string>(); // clés déjà liées dans CET article
	used.add(`${selfKind}:${selfId}`);
	let count = 0;

	const SENT_L = "";
	const SENT_R = "";
	const stash: string[] = [];
	const mask = (text: string): string =>
		text
			// liens markdown déjà présents
			.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => {
				stash.push(m);
				return `${SENT_L}${stash.length - 1}${SENT_R}`;
			})
			// code inline
			.replace(/`[^`]*`/g, (m) => {
				stash.push(m);
				return `${SENT_L}${stash.length - 1}${SENT_R}`;
			});
	const unmask = (text: string): string =>
		text.replace(new RegExp(`${SENT_L}(\\d+)${SENT_R}`, "g"), (_m, i) => stash[Number(i)]);

	const lines = article.split("\n");
	const outLines = lines.map((line) => {
		if (/^\s{0,3}#/.test(line)) return line; // titres : pas de lien
		const masked = mask(line);
		const linked = masked.replace(re, (m) => {
			const t = byKey.get(m.toLowerCase());
			if (!t) return m;
			// jamais l'entité elle-même, ni un alias « Son … » de son propre nom
			if (t.kind === selfKind && t.id === selfId) return m;
			if (canonKey(m) === selfCanon) return m;
			const id = `${t.kind}:${t.id}`;
			if (used.has(id)) return m;
			// nom propre : 1re lettre majuscule dans le texte trouvé
			if (m[0] !== m[0].toUpperCase() || m[0] === m[0].toLowerCase()) return m;
			used.add(id);
			count++;
			return `[${m}](${t.url})`;
		});
		return unmask(linked);
	});
	return [outLines.join("\n"), count];
}

async function main() {
	const targets = await loadTargets();
	// Map clé→cible : sur collision de nom (doublons d'entités), on PRÉFÈRE la page
	// qui a un article (canonique), puis le plus petit id.
	const byKey = new Map<string, Target>();
	for (const t of targets) {
		const cur = byKey.get(t.key);
		if (!cur) {
			byKey.set(t.key, t);
			continue;
		}
		const better =
			(t.hasArticle && !cur.hasArticle) || (t.hasArticle === cur.hasArticle && t.id < cur.id);
		if (better) byKey.set(t.key, t);
	}
	console.log(`${targets.length} entités liables (${byKey.size} noms uniques).`);

	const kinds = (ONLY_TYPE ? [ONLY_TYPE] : Object.keys(KINDS)) as Kind[];
	let totalArticles = 0,
		totalLinks = 0,
		changed = 0;

	for (const kind of kinds) {
		const cfg = KINDS[kind];
		const where = ["article IS NOT NULL", "length(article) > 0"];
		if (IDS?.length) where.push(`id IN (${IDS.join(",")})`);
		const rows = (await pg.unsafe(
			`SELECT id, name, article FROM bot.${cfg.table} WHERE ${where.join(" AND ")} ORDER BY id`
		)) as unknown as { id: number; name: string; article: string }[];

		let n = 0;
		for (const r of rows) {
			if (n >= LIMIT) break;
			n++;
			totalArticles++;
			const [next, links] = linkify(r.article, targets, byKey, kind, r.id, r.name ?? "");
			if (links > 0 && next !== r.article) {
				totalLinks += links;
				changed++;
				if (APPLY) {
					await pg.begin(async (tx) => {
						const updated = await tx.unsafe(
							`UPDATE bot.${cfg.table} SET article = $1 WHERE id = $2 AND article = $3 RETURNING id`,
							[next, r.id, r.article]
						);
						if (updated.length === 0) return;
						await tx`
							INSERT INTO public.wiki_revisions
							 (id, "tableName", "rowId", action, label, before, after, "editorId", "editorName")
							 VALUES (
								${randomBytes(12).toString("hex")}, ${cfg.table}, ${String(r.id)}, 'update',
								${`Liens internes déterministes — ${r.name}`},
								${tx.json({ article: r.article })}, ${tx.json({ article: next })},
								${"agent-shenron"}, ${"Shenron wiki linkifier"}
							 )
						`;
					});
				}
			}
		}
		console.log(`[${kind}] ${n} articles · ${changed} modifiés cumulés`);
	}

	console.log(
		`\n${APPLY ? "APPLY" : "DRY-RUN"} · articles=${totalArticles} · modifiés=${changed} · liens insérés=${totalLinks}` +
			(APPLY ? "" : "  (relancer avec --apply pour écrire)")
	);
	await pg.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
