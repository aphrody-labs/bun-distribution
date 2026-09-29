#!/usr/bin/env bun
/**
 * Métadonnées d'édition des tomes de *Dragon Ball Super*, prises chez l'éditeur.
 *
 * POURQUOI CE SCRIPT
 * ------------------
 * Mesuré le 2026-09-04 : les 42 tomes de la série `DB` portent tous leur ISBN,
 * leur titre japonais et leur date de parution ; les **23 tomes `DBS` n'en
 * avaient aucun**, et le tome 24 (paru le 2025-04-04) manquait purement et
 * simplement. Ce sont des faits d'édition — ni protégeables, ni interprétables.
 *
 * LA SOURCE, ET POURQUOI ELLE EST LA BONNE
 * ----------------------------------------
 * `books.shueisha.co.jp`, c'est-à-dire l'éditeur lui-même : sa fiche produit
 * embarque un blob JSON (`var ssd = {…}`) qui porte l'ISBN, le titre, la date
 * de parution AU JOUR et la pagination. Surtout, chaque fiche porte le champ
 * `next_item.isbn` : la série se parcourt de proche en proche depuis le seul
 * tome 1, sans jamais deviner un identifiant. Vérification croisée possible
 * chez la Bibliothèque nationale de la Diète (NDL), qui donne les mêmes ISBN.
 *
 * Écarté à dessein : openBD (ses conditions interdisent la modification des
 * données et n'en autorisent l'usage que pour la promotion de livres) et
 * Google Books (quota épuisé sur IP anonyme, redondant ici).
 *
 * UNE CONVENTION À CONNAÎTRE AVANT DE LIRE LES RÉSULTATS
 * -----------------------------------------------------
 * Sur la série `DB`, `title_ja` porte le SOUS-TITRE du volume
 * (`巻一 孫悟空と仲間たち`). Les tankōbon de *Super* n'en ont pas : NDL, openBD
 * et Shueisha concordent tous les trois. `title_ja` y vaut donc le titre du
 * volume (`ドラゴンボール超 1`) — ce n'est pas un appauvrissement, c'est ce que
 * porte l'ouvrage. Ne pas inventer de sous-titre pour homogénéiser.
 *
 * SIMULATION PAR DÉFAUT. Chaque écriture passe par `public.wiki_revisions`,
 * donc tout est réversible depuis `/admin/wiki/history`.
 *
 * Usage :
 *   bun scripts/ingere-tomes-dbs.ts                 # simulation
 *   bun scripts/ingere-tomes-dbs.ts --appliquer
 *   bun scripts/ingere-tomes-dbs.ts --recrire       # écrase aussi les champs déjà remplis
 */
import { join } from "node:path";
import postgres from "postgres";
import { SITE_URL } from "../src/lib/config";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const APPLIQUER = flag("appliquer");
const RECRIRE = flag("recrire");
const DELAI = Number(opt("delai", "1000"));
/** Le tome 1 : seul identifiant écrit en dur, tous les autres se déduisent de la chaîne. */
const ISBN_DEPART = opt("depart", "978-4-08-880661-7")!;
const MAX_TOMES = Number(opt("max", "40"));
const AGENT = `${new URL(SITE_URL).host}-bibliographie/1.0 (metadonnees d'edition; +${SITE_URL})`;

type Fiche = {
	isbn: string;
	titre: string;
	volume: number | null;
	parution: string | null;
	suivant: string | null;
};

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	// La DERNIÈRE ligne `^DATABASE_URL=` fait foi : l'ancienne URL Neon la précède, en commentaire.
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/site/.env).");
		process.exit(1);
	}
	return valeur;
}

/** curl plutôt que `fetch` : mesuré ailleurs sur ce projet, l'empreinte TLS de Bun se fait filtrer. */
async function page(url: string): Promise<string> {
	const proc = Bun.spawn(["curl", "-sS", "-m", "40", "-A", AGENT, "--compressed", url], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const texte = await new Response(proc.stdout).text();
	await proc.exited;
	return texte;
}

/**
 * La fiche produit porte son JSON dans `var ssd = {…};`. On le lit par
 * accolades appariées plutôt qu'à la regex : le blob contient des objets
 * imbriqués (`series_data`, `next_item`) qu'un `\{.*?\}` couperait en deux.
 */
function blobSsd(html: string): Record<string, unknown> | null {
	const debut = html.indexOf("var ssd");
	if (debut === -1) return null;
	const ouvrante = html.indexOf("{", debut);
	if (ouvrante === -1) return null;
	let profondeur = 0;
	let dansChaine = false;
	let echappe = false;
	for (let i = ouvrante; i < html.length; i++) {
		const c = html[i]!;
		if (dansChaine) {
			if (echappe) echappe = false;
			else if (c === "\\") echappe = true;
			else if (c === '"') dansChaine = false;
			continue;
		}
		if (c === '"') dansChaine = true;
		else if (c === "{") profondeur++;
		else if (c === "}") {
			profondeur--;
			if (profondeur === 0) {
				try {
					return JSON.parse(html.slice(ouvrante, i + 1)) as Record<string, unknown>;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

function fiche(html: string): Fiche | null {
	const blob = blobSsd(html);
	// Le blob est une enveloppe : `{"count":1,"datas":[{…la fiche…}]}`.
	const ssd = (blob?.datas as Record<string, unknown>[] | undefined)?.[0];
	if (!ssd) return null;
	const titre = String(ssd.item_name ?? "").trim();
	if (!titre) return null;
	// `ドラゴンボール超／1` : le numéro de tome suit la barre pleine chasse.
	const numero = titre.match(/／\s*(\d+)/)?.[1];
	const suivant = (ssd.next_item as { isbn?: string } | undefined)?.isbn ?? null;
	return {
		isbn: String(ssd.isbn ?? "").trim(),
		titre,
		volume: numero ? Number(numero) : null,
		parution: String(ssd.release_date ?? "").match(/^\d{4}-\d{2}-\d{2}$/)
			? String(ssd.release_date)
			: null,
		suivant,
	};
}

/** Identifiant de révision au même format que ceux du site (24 signes base36). */
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

// ------------------------------------------------------------ relevé chez l'éditeur

const fiches: Fiche[] = [];
let isbn: string | null = ISBN_DEPART;
const vus = new Set<string>();
while (isbn && fiches.length < MAX_TOMES && !vus.has(isbn)) {
	vus.add(isbn);
	const f = fiche(await page(`https://books.shueisha.co.jp/items/contents.html?isbn=${isbn}`));
	if (!f) {
		console.error(`  ⊘ fiche illisible pour ${isbn} — chaîne interrompue.`);
		break;
	}
	fiches.push(f);
	console.log(
		`  ${String(f.volume ?? "?").padStart(2)} · ${f.isbn} · ${f.parution ?? "date absente"} · ${f.titre}`
	);
	isbn = f.suivant;
	if (isbn) await Bun.sleep(DELAI);
}
console.log(`\n${fiches.length} fiche(s) relevée(s) chez l'éditeur.\n`);

// -------------------------------------------------------------------- rapprochement

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	const enBase = await sql<
		{
			id: string;
			volume_number: string;
			title: string;
			title_ja: string | null;
			isbn: string | null;
			published_at: string | null;
		}[]
	>`
		SELECT id, volume_number, title, title_ja, isbn, published_at
		FROM bot.db_manga_volumes WHERE series = 'DBS' ORDER BY volume_number`;
	// postgres-js rend les bigint en CHAÎNES : sans Number(), la clé ne s'apparie pas.
	const parNumero = new Map(enBase.map((v) => [Number(v.volume_number), v]));

	let majs = 0;
	let creations = 0;
	for (const f of fiches) {
		if (f.volume === null) continue;
		const ligne = parNumero.get(f.volume);
		const parution = f.parution ? Math.floor(Date.parse(`${f.parution}T00:00:00Z`) / 1000) : null;
		// Le titre japonais du volume, tel que l'éditeur l'écrit, barre pleine chasse remplacée.
		const titreJa = f.titre.replace(/／\s*/, " ");

		if (!ligne) {
			console.log(`  + tome ${f.volume} ABSENT de la base → création (${f.isbn}, ${f.parution})`);
			creations++;
			if (!APPLIQUER) continue;
			await sql.begin(async (tx) => {
				// `id` est un bigint SANS séquence sur les tables du wiki (piège connu du
				// dépôt) : un INSERT qui l'omet échoue sur la contrainte NOT NULL.
				const [{ suivant }] = await tx<{ suivant: number }[]>`
					SELECT coalesce(max(id), 0) + 1 AS suivant FROM bot.db_manga_volumes`;
				const [cree] = await tx<{ id: string }[]>`
					INSERT INTO bot.db_manga_volumes ${tx({
						id: Number(suivant),
						series: "DBS",
						volume_number: f.volume,
						title: `Dragon Ball Super Vol. ${f.volume}`,
						title_ja: titreJa,
						isbn: f.isbn || null,
						published_at: parution,
						visible: true,
					})} RETURNING id`;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: idRevision(),
					tableName: "db_manga_volumes",
					rowId: String(cree!.id),
					action: "create",
					label: `Dragon Ball Super Vol. ${f.volume}`,
					before: tx.json({}),
					after: tx.json({ title_ja: titreJa, isbn: f.isbn || null, published_at: parution }),
					editorId: "agent",
					editorName: "Script ingere-tomes-dbs (fiches produit Shueisha)",
				})}`;
			});
			continue;
		}

		const avant = {
			title_ja: ligne.title_ja,
			isbn: ligne.isbn,
			published_at: ligne.published_at ? Number(ligne.published_at) : null,
		};
		const apres = {
			title_ja: RECRIRE || !ligne.title_ja ? titreJa : ligne.title_ja,
			isbn: RECRIRE || !ligne.isbn ? f.isbn || null : ligne.isbn,
			published_at: RECRIRE || !ligne.published_at ? parution : Number(ligne.published_at),
		};
		if (JSON.stringify(avant) === JSON.stringify(apres)) continue;

		console.log(
			`  ~ tome ${String(f.volume).padStart(2)} · ${apres.isbn} · ${f.parution} · ${apres.title_ja}`
		);
		majs++;
		if (!APPLIQUER) continue;
		await sql.begin(async (tx) => {
			await tx`UPDATE bot.db_manga_volumes SET title_ja = ${apres.title_ja}, isbn = ${apres.isbn}, published_at = ${apres.published_at} WHERE id = ${Number(ligne.id)}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_manga_volumes",
				rowId: String(ligne.id),
				action: "update",
				label: ligne.title,
				before: tx.json(avant),
				after: tx.json(apres),
				editorId: "agent",
				editorName: "Script ingere-tomes-dbs (fiches produit Shueisha)",
			})}`;
		});
	}

	console.log(
		APPLIQUER
			? `\n✔ ${majs} tome(s) complété(s), ${creations} créé(s), le tout versionné.`
			: `\n${majs} tome(s) à compléter, ${creations} à créer.\n(simulation — relancer avec --appliquer)`
	);
} catch (e) {
	console.error("✗", e instanceof Error ? e.message : e);
	process.exitCode = 1;
} finally {
	await sql.end();
}
