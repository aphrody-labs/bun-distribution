#!/usr/bin/env bun
/**
 * Dépôt d'un contenu de wiki rédigé à partir des sources (manga, databooks).
 *
 * Écrit dans le PostgreSQL `bot.*` — SOURCE DE VÉRITÉ du wiki — et enregistre
 * une révision dans `public.wiki_revisions`, donc tout dépôt est réversible
 * depuis `/admin/wiki/history`. Ne jamais écrire le wiki dans le SQLite du bot :
 * le reverse-sync l'écraserait.
 *
 * SIMULATION PAR DÉFAUT. Rien ne part en base sans `--appliquer`.
 *
 * Deux formes de dépôt :
 *
 *   champ    une colonne d'une fiche (`description`, `article`, `race`, `ki`…)
 *   section  un bloc de `bot.db_wiki_sections` (Histoire, Personnalité…),
 *            la forme normale du contenu long depuis la refonte CMS
 *
 * Usage :
 *   bun scripts/depose-wiki.ts champ --table db_characters --id 11 \
 *       --colonne description --fichier /tmp/desc.md --sources /tmp/src.json [--appliquer]
 *
 *   bun scripts/depose-wiki.ts section --type character --id 11 \
 *       --cle histoire --label "Histoire" --fichier /tmp/histoire.md \
 *       [--ordre 0] [--accent orange] [--appliquer]
 *
 * `--sources` : JSON `[{"n":1,"kind":"manga","label":"Manga DB — tome 17, planche 42","url":"/wiki/manga"}]`
 * (chemin de fichier ou JSON inline). Renseigne `article_sources` quand la
 * colonne déposée est `article`.
 *
 * Le texte est refusé s'il est vide, s'il dépasse 40 000 signes, ou s'il porte
 * les marqueurs d'une rédaction non sourcée (« probablement », « sans doute »,
 * « inconnu »), que la consigne de rédaction interdit.
 */
import { join } from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const TABLES = new Set([
	"db_characters",
	"db_planets",
	"db_techniques",
	"db_transformations",
	"db_races",
	"db_sagas",
	"db_arcs",
	"db_episodes",
	"db_movies",
	"db_games",
	"db_databooks",
]);
const TYPES: Record<string, string> = {
	character: "db_characters",
	planet: "db_planets",
	technique: "db_techniques",
	transformation: "db_transformations",
	race: "db_races",
	saga: "db_sagas",
	episode: "db_episodes",
	movie: "db_movies",
	game: "db_games",
};
/**
 * Colonne qui porte le libellé humain de la fiche. Les tables issues des médias
 * (épisodes, films, jeux, databooks) disent `title` là où le wiki dit `name` :
 * lire `name` en dur faisait échouer le dépôt sur ces quatre tables.
 */
const LIBELLE: Record<string, string> = {
	db_episodes: "title",
	db_movies: "title",
	db_games: "title",
	db_databooks: "title",
};
const libelle = (table: string) => LIBELLE[table] ?? "name";

/** Tournures qui trahissent une fiche écrite de mémoire plutôt que sourcée. */
const INTERDITS =
	/\b(probablement|sans doute|vraisemblablement|on suppose|il semblerait|inconnue?\s*$)/i;

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const ligne = texte.split("\n").find((l) => l.startsWith("DATABASE_URL="));
	const valeur = ligne
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

async function lireTexte(): Promise<string> {
	const fichier = opt("fichier");
	const inline = opt("texte");
	const brut = fichier ? await Bun.file(fichier).text() : (inline ?? "");
	const texte = brut.trim();
	if (!texte) {
		console.error("✗ texte vide (--fichier ou --texte).");
		process.exit(2);
	}
	if (texte.length > 40_000) {
		console.error(`✗ texte trop long (${texte.length} signes).`);
		process.exit(2);
	}
	const faute = INTERDITS.exec(texte);
	if (faute) {
		console.error(`✗ tournure non sourcée : « ${faute[0]} ». Une source ou rien.`);
		process.exit(2);
	}
	return texte;
}

async function lireSources(): Promise<unknown[] | null> {
	const v = opt("sources");
	if (!v) return null;
	const brut = v.trim().startsWith("[") ? v : await Bun.file(v).text();
	const parsed = JSON.parse(brut);
	if (!Array.isArray(parsed)) {
		console.error("✗ --sources doit être un tableau JSON.");
		process.exit(2);
	}
	return parsed;
}

/**
 * Sérialise une valeur en jsonb. `sql.json()` et non `JSON.stringify(...)::jsonb` :
 * postgres-js type le paramètre d'après le cast et ré-encode la chaîne, ce qui écrit
 * un SCALAIRE string au lieu du tableau (même piège que `db_episodes.players`).
 * Le cast couvre les tableaux, que les types du driver refusent alors qu'il les gère.
 */
const jsonb = (valeur: unknown) => sql.json(valeur as Parameters<typeof sql.json>[0]);

/** Identifiant de révision au même format que ceux du site (24 signes base36). */
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const APPLIQUER = flag("appliquer");
const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	const commande = args[0];

	if (commande === "champ") {
		const table = opt("table")!;
		const id = Number(opt("id"));
		const colonne = opt("colonne")!;
		if (!TABLES.has(table)) throw new Error(`table inconnue : ${table}`);
		if (!/^[a-z_]+$/.test(colonne)) throw new Error(`colonne invalide : ${colonne}`);
		if (!Number.isFinite(id)) throw new Error("--id manquant");

		const texte = await lireTexte();
		const sources = await lireSources();
		const [avant] = (await sql.unsafe(
			`SELECT ${libelle(table)} AS name, ${colonne} AS valeur FROM bot.${table} WHERE id = $1`,
			[id]
		)) as unknown as { name: string; valeur: unknown }[];
		if (!avant) throw new Error(`${table}#${id} introuvable`);

		console.log(`${table}#${id} « ${avant.name} » → ${colonne}`);
		console.log(
			`  avant : ${avant.valeur === null ? "∅" : `${String(avant.valeur).length} signes`}`
		);
		console.log(
			`  après : ${texte.length} signes${sources ? ` + ${sources.length} source(s)` : ""}`
		);
		if (!APPLIQUER) {
			console.log("\n(simulation — relancer avec --appliquer)");
			process.exit(0);
		}

		await sql.begin(async (tx) => {
			await tx.unsafe(`UPDATE bot.${table} SET ${colonne} = $1 WHERE id = $2`, [texte, id]);
			if (colonne === "article") {
				await tx.unsafe(`UPDATE bot.${table} SET article_updated_at = $1 WHERE id = $2`, [
					Date.now(),
					id,
				]);
				if (sources)
					await tx`UPDATE ${tx.unsafe(`bot.${table}`)} SET article_sources = ${jsonb(sources)} WHERE id = ${id}`;
			}
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: table,
				rowId: String(id),
				action: "update",
				label: avant.name ?? `${table}#${id}`,
				before: jsonb({ [colonne]: avant.valeur ?? null }),
				after: jsonb({ [colonne]: texte, ...(sources ? { article_sources: sources } : {}) }),
				editorId: "agent",
				editorName: "Agent dbfr-wiki (sources manga + databooks)",
			})}`;
		});
		console.log("✔ déposé et versionné.");
	} else if (commande === "section") {
		const type = opt("type")!;
		const id = Number(opt("id"));
		const cle = opt("cle")!;
		const label = opt("label")!;
		if (!TYPES[type]) throw new Error(`type inconnu : ${type}`);
		if (!/^[a-z0-9-]+$/.test(cle)) throw new Error(`clé invalide : ${cle} (kebab-case)`);
		if (!label) throw new Error("--label manquant");
		if (!Number.isFinite(id)) throw new Error("--id manquant");

		const texte = await lireTexte();
		const [cible] = (await sql.unsafe(
			`SELECT ${libelle(TYPES[type]!)} AS name FROM bot.${TYPES[type]} WHERE id = $1`,
			[id]
		)) as unknown as { name: string }[];
		if (!cible) throw new Error(`${TYPES[type]}#${id} introuvable`);

		const [existante] = await sql<{ id: number; body: string; sort_order: number }[]>`
			SELECT id, body, sort_order FROM bot.db_wiki_sections
			WHERE entity_type = ${type} AND entity_id = ${id} AND key = ${cle}`;
		const [{ max }] = await sql<{ max: number | null }[]>`
			SELECT max(sort_order) AS max FROM bot.db_wiki_sections WHERE entity_type = ${type} AND entity_id = ${id}`;
		const ordre = Number(opt("ordre", String(existante?.sort_order ?? Number(max ?? -1) + 1)));
		const accent = opt("accent", "orange")!;

		console.log(`${type}#${id} « ${cible.name} » → section ${cle} « ${label} » [ordre ${ordre}]`);
		console.log(
			`  avant : ${existante ? `${existante.body?.length ?? 0} signes (mise à jour)` : "∅ (création)"}`
		);
		console.log(`  après : ${texte.length} signes`);
		if (!APPLIQUER) {
			console.log("\n(simulation — relancer avec --appliquer)");
			process.exit(0);
		}

		await sql.begin(async (tx) => {
			if (existante) {
				await tx`UPDATE bot.db_wiki_sections SET body = ${texte}, label = ${label}, accent = ${accent}, sort_order = ${ordre}, visible = true WHERE id = ${existante.id}`;
			} else {
				await tx`INSERT INTO bot.db_wiki_sections ${tx({
					entity_type: type,
					entity_id: id,
					key: cle,
					label,
					accent,
					body: texte,
					sort_order: ordre,
					visible: true,
				})}`;
			}
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_wiki_sections",
				rowId: `${type}:${id}:${cle}`,
				action: existante ? "update" : "create",
				label: `${cible.name} — ${label}`,
				before: jsonb({ body: existante?.body ?? null }),
				after: jsonb({ body: texte }),
				editorId: "agent",
				editorName: "Agent dbfr-wiki (sources manga + databooks)",
			})}`;
		});
		console.log("✔ déposé et versionné.");
	} else {
		console.error(
			await Bun.file(import.meta.path)
				.text()
				.then((t) => t.split("*/")[0]!.replace(/^#!.*\n/, ""))
		);
		process.exit(2);
	}
} catch (e) {
	console.error(`✗ ${(e as Error).message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
}
