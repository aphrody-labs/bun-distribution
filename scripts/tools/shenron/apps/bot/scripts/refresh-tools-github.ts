#!/usr/bin/env bun
/**
 * Rafraîchit les métadonnées GitHub des dépôts listés dans `bot.db_tools`
 * (page publique `/wiki/tools`).
 *
 * POURQUOI CE SCRIPT EXISTE : la table a été moissonnée UNE FOIS, puis plus
 * jamais. Les étoiles sont figées au jour du moissonnage, les dépôts archivés
 * ou supprimés restent affichés comme vivants, et rien ne dit quand la ligne a
 * été vérifiée pour la dernière fois. Une page qui prétend recenser l'outillage
 * communautaire et qui ment sur son état vaut moins que pas de page du tout.
 *
 * CE QU'IL NE FAIT PAS, et c'est délibéré :
 *  - il ne SUPPRIME jamais une ligne. Un dépôt disparu (404) passe
 *    `visible = false` ; la doctrine du dépôt interdit la suppression
 *    éditoriale dure.
 *  - il ne TRADUIT rien. Les descriptions du site ont été traduites en français
 *    à la main ; réécrire depuis l'amont anglais à chaque passage les
 *    détruirait. La description n'est remplacée que dans trois cas, décrits par
 *    `descriptionRemplacable()` : vide, shortcode emoji non rendu (`:dragon:`),
 *    ou trop courte pour dire quoi que ce soit (< 25 caractères). Dans ce cas
 *    la description GitHub est déposée TELLE QUELLE — la traduire proprement
 *    est un geste éditorial humain, pas un effet de bord de rafraîchissement.
 *  - il ne juge pas la pertinence. Un dépôt hors sujet reste visible ; c'est à
 *    un humain de le masquer.
 *
 * Idempotent et rejouable : chaque passage réécrit les mêmes colonnes calculées
 * (`stars`, `language`, `archived`, `pushed_at`, `checked_at`) à partir de
 * l'amont, sans état local.
 *
 * SIMULATION PAR DÉFAUT.
 *
 * Usage :
 *   bun scripts/refresh-tools-github.ts               # rapport seul
 *   bun scripts/refresh-tools-github.ts --appliquer   # écrit dans Postgres
 *
 * Prérequis : le CLI `gh` authentifié (`gh auth status`).
 */
import postgres from "postgres";
import { join } from "node:path";

const APPLIQUER = process.argv.includes("--appliquer");

/** Seuil sous lequel une description est jugée vide de sens. */
const LONGUEUR_MINIMALE = 25;

type Ligne = {
	id: number;
	slug: string;
	name: string;
	url: string | null;
	description: string | null;
	language: string | null;
	stars: number | null;
	visible: boolean;
	archived: boolean;
};

type Amont = {
	stars: number;
	language: string | null;
	archived: boolean;
	pushedAt: number | null;
	description: string | null;
};

// ── Base ────────────────────────────────────────────────────────────────────

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", "..", "site", ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE : `.env` porte l'ancienne URL Neon AVANT la locale.
	const valeur = texte
		.split("\n")
		.findLast((l) => l.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

// ── Amont GitHub ────────────────────────────────────────────────────────────

/** Extrait `owner/name` d'une URL GitHub ; null si l'URL n'en est pas une. */
function chemin(url: string | null): string | null {
	if (!url) return null;
	const m = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
	if (!m) return null;
	return `${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

type Resultat =
	| { etat: "ok"; amont: Amont }
	| { etat: "disparu" }
	| { etat: "quota" }
	| { etat: "erreur"; message: string };

/** Interroge `gh api repos/<owner>/<name>` et classe la réponse. */
async function interroge(depot: string): Promise<Resultat> {
	const proc = Bun.spawn(["gh", "api", `repos/${depot}`], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [sortie, erreur, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		const bruit = `${sortie}\n${erreur}`;
		if (/HTTP 404|Not Found/i.test(bruit)) return { etat: "disparu" };
		if (/HTTP 403|HTTP 429|rate limit/i.test(bruit)) return { etat: "quota" };
		return { etat: "erreur", message: erreur.trim().split("\n")[0] || `code ${code}` };
	}
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(sortie);
	} catch {
		return { etat: "erreur", message: "réponse illisible" };
	}
	const pousse = typeof json.pushed_at === "string" ? Date.parse(json.pushed_at) : NaN;
	return {
		etat: "ok",
		amont: {
			stars: Number(json.stargazers_count ?? 0),
			language: typeof json.language === "string" ? json.language : null,
			archived: Boolean(json.archived),
			pushedAt: Number.isFinite(pousse) ? pousse : null,
			description: typeof json.description === "string" ? json.description.trim() : null,
		},
	};
}

// ── Règle éditoriale sur la description ─────────────────────────────────────

/**
 * Vrai si la description actuelle peut être remplacée par celle de GitHub.
 * Volontairement restrictif : le français déjà en place est la vérité.
 */
function descriptionRemplacable(actuelle: string | null): boolean {
	const t = (actuelle ?? "").trim();
	if (!t) return true;
	// Shortcode emoji jamais rendu, du type `:dragon:` ou `:dragon :`.
	if (/:[a-z0-9_+-]+\s*:/i.test(t)) return true;
	return t.length < LONGUEUR_MINIMALE;
}

// ── Exécution ───────────────────────────────────────────────────────────────

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const maintenant = Date.now();

try {
	const lignes = await sql<Ligne[]>`
		SELECT id, slug, name, url, description, language, stars, visible, archived
		FROM bot.db_tools
		ORDER BY id
	`;
	console.log(
		`${lignes.length} outils — ${APPLIQUER ? "ÉCRITURE" : "SIMULATION (--appliquer pour écrire)"}`
	);

	let rafraichis = 0;
	let disparus = 0;
	let archives = 0;
	let descriptions = 0;
	const incidents: string[] = [];

	for (const ligne of lignes) {
		const depot = chemin(ligne.url);
		if (!depot) {
			incidents.push(`${ligne.slug} : URL non GitHub (${ligne.url ?? "vide"})`);
			continue;
		}

		const res = await interroge(depot);

		if (res.etat === "quota") {
			console.error("✗ Quota GitHub atteint — arrêt propre, relancer plus tard.");
			break;
		}
		if (res.etat === "erreur") {
			incidents.push(`${ligne.slug} : ${res.message}`);
			continue;
		}
		if (res.etat === "disparu") {
			disparus += 1;
			console.log(`  ✗ ${depot} — 404, masqué (visible=false)`);
			if (APPLIQUER) {
				await sql`
					UPDATE bot.db_tools
					SET visible = false, checked_at = ${maintenant}
					WHERE id = ${ligne.id}
				`;
			}
			continue;
		}

		const { amont } = res;
		const remplace = descriptionRemplacable(ligne.description) && Boolean(amont.description);
		if (remplace) descriptions += 1;
		if (amont.archived) archives += 1;

		const deltas: string[] = [];
		// `stars` remonte en texte depuis un bigint PG → comparer en nombre.
		const etoilesActuelles = Number(ligne.stars ?? 0);
		if (etoilesActuelles !== amont.stars) deltas.push(`⭐ ${etoilesActuelles} → ${amont.stars}`);
		if ((ligne.language ?? null) !== amont.language)
			deltas.push(`langage ${ligne.language ?? "∅"} → ${amont.language ?? "∅"}`);
		if (ligne.archived !== amont.archived) deltas.push(`archivé → ${amont.archived}`);
		if (remplace) deltas.push("description réécrite depuis l'amont");

		if (deltas.length) {
			rafraichis += 1;
			console.log(`  · ${depot} — ${deltas.join(", ")}`);
		}

		if (APPLIQUER) {
			await sql`
				UPDATE bot.db_tools
				SET stars = ${amont.stars},
				    language = ${amont.language},
				    archived = ${amont.archived},
				    pushed_at = ${amont.pushedAt},
				    checked_at = ${maintenant},
				    description = ${remplace ? amont.description : ligne.description}
				WHERE id = ${ligne.id}
			`;
		}
	}

	console.log(
		`\nRésumé : ${rafraichis} lignes modifiées, ${disparus} disparues (masquées), ` +
			`${archives} archivées en amont, ${descriptions} descriptions réécrites.`
	);
	if (incidents.length) {
		console.log("Incidents :");
		for (const i of incidents) console.log(`  ! ${i}`);
	}
	if (!APPLIQUER) console.log("\nSimulation — rien n'a été écrit.");
} finally {
	await sql.end();
}
