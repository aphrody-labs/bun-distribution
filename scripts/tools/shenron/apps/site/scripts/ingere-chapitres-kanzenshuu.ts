#!/usr/bin/env bun
import { tempPath } from "@aphrody/paths";
/**
 * Titre japonais et date de première parution des CHAPITRES du manga.
 *
 * POURQUOI CE SCRIPT
 * ------------------
 * Mesuré le 2026-09-04 : les 665 lignes de `bot.db_manga_chapters` n'avaient
 * **aucun** `title_ja` et **aucune** `published_at`. Les 42 tomes, eux, portent
 * les deux depuis le relevé du catalogue — c'est l'échelon du chapitre qui était
 * resté vide, alors que c'est lui que la lecture en ligne affiche.
 *
 * LA SOURCE
 * ---------
 * `kanzenshuu.com`, guide de référence de la série depuis vingt ans : ses pages
 * `/manga/db/list/` et `/manga/super/list/` donnent, pour chaque chapitre, son
 * numéro, son titre japonais, sa romanisation, le numéro de *Weekly Shōnen Jump*
 * (ou de *V-Jump*) où il a paru et la date de ce numéro. Ce sont des faits
 * d'édition, vérifiables sur les tomes eux-mêmes.
 *
 * CE QU'ON PREND, ET CE QU'ON LAISSE
 * ----------------------------------
 * On prend le **titre japonais** (le titre de l'œuvre, factuel) et la **date de
 * parution**. On ne prend NI la romanisation NI la traduction anglaise : ce sont
 * le travail éditorial de Kanzenshuu, pas des faits. Nos titres français, eux,
 * viennent déjà de l'édition Glénat et ne sont pas touchés.
 *
 * DEUX PIÈGES DE LECTURE, TOUS DEUX MESURÉS
 * -----------------------------------------
 *  1. Les titres portent des `<ruby>` : `<ruby>球<rp>(</rp><rt>ボール</rt>…` se lit
 *     « ボール » mais s'écrit `球`. On garde la BASE et on jette le `<rt>`, sinon
 *     le titre stocké ne correspond à aucune graphie imprimée.
 *  2. `published_at` est en **secondes** epoch sur ces tables (`495590400` =
 *     1985-09-15), pas en millisecondes comme ailleurs dans le site.
 *
 * APPARIEMENT
 * -----------
 * Notre série `DBFC` (Full Color) est numérotée 0…519 : le 0 est un chapitre
 * hors série, les 1…519 correspondent un pour un aux chapitres du manga. La
 * série `DB` (42 lignes) est un index PAR TOME, pas par chapitre : ses lignes
 * héritent du titre japonais et de la date de leur tome, jamais d'un chapitre.
 * `DBS` s'apparie directement sur le numéro.
 *
 * SIMULATION PAR DÉFAUT. Une révision `public.wiki_revisions` par ligne écrite,
 * donc tout est annulable depuis `/admin/wiki/history`.
 *
 * Usage :
 *   bun scripts/ingere-chapitres-kanzenshuu.ts                  # simulation
 *   bun scripts/ingere-chapitres-kanzenshuu.ts --appliquer
 *   bun scripts/ingere-chapitres-kanzenshuu.ts --serie DBS      # un seul corpus
 *   bun scripts/ingere-chapitres-kanzenshuu.ts --recrire        # écrase l'existant
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
const SERIE = opt("serie");
const CACHE = opt("cache", tempPath("kanzenshuu-cache"))!;
const AGENT = `${new URL(SITE_URL).host}-bibliographie/1.0 (metadonnees d'edition; +${SITE_URL})`;

/** Les deux relevés : la page source, et la série de NOTRE base qu'elle alimente. */
const CORPUS = [
	{
		serie: "DBFC",
		url: "https://www.kanzenshuu.com/manga/db/list/",
		libelle: "Dragon Ball (519 chapitres)",
	},
	{
		serie: "DBS",
		url: "https://www.kanzenshuu.com/manga/super/list/",
		libelle: "Dragon Ball Super",
	},
] as const;

type Chapitre = {
	numero: number;
	titreJa: string;
	parution: number | null;
	magazine: string | null;
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

/** curl plutôt que `fetch` : mesuré sur ce projet, l'empreinte TLS de Bun se fait filtrer. */
async function page(url: string): Promise<string> {
	const fichier = Bun.file(join(CACHE, `${Bun.hash(url).toString(36)}.html`));
	if (await fichier.exists()) return fichier.text();
	const proc = Bun.spawn(["curl", "-sS", "-m", "60", "-A", AGENT, "--compressed", url], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const texte = await new Response(proc.stdout).text();
	await proc.exited;
	if (texte.length > 1000) await Bun.write(fichier, texte);
	return texte;
}

const ENTITES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#8217;": "’",
	"&#8216;": "‘",
	"&#8220;": "“",
	"&#8221;": "”",
	"&#8230;": "…",
	"&nbsp;": " ",
};

/**
 * Le titre japonais tel qu'il est IMPRIMÉ : on garde la base des `<ruby>` et on
 * jette la lecture (`<rt>`), sinon `球` deviendrait `ボール` — une graphie qui
 * n'existe sur aucune couverture.
 */
function titreJaponais(cellule: string): string {
	const lien = cellule.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? cellule;
	const premiereLigne = lien.split(/<br\s*\/?>/i)[0] ?? "";
	return premiereLigne
		.replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, "")
		.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&#?\w+;/g, (e) => ENTITES[e] ?? e)
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Un tableau par page, une ligne `<tr>` par chapitre : `td.nmbr`, `td.chp-title`,
 * `td.date`.
 *
 * La date est parfois **absente de la ligne** : quand deux chapitres paraissent
 * dans le même numéro de magazine, la cellule porte `rowspan="2"` et n'appartient
 * qu'au premier des deux. Lire par expression sur trois cellules consécutives
 * perdait donc 7 chapitres sur 519 (256, 257, 306, 307, 372, 373, 387), tous
 * seconds d'une paire. On lit ligne à ligne et on hérite de la date précédente,
 * ce qui est exactement le sens du `rowspan`.
 */
function chapitres(html: string): Chapitre[] {
	const sortie: Chapitre[] = [];
	let derniereDate: { parution: number | null; magazine: string | null } | null = null;
	for (const [ligne] of html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)) {
		const numero = ligne.match(/<td class="nmbr">(\d+)<\/td>/)?.[1];
		const cellule = ligne.match(/<td class="chp-title">([\s\S]*?)<\/td>/)?.[1];
		if (!numero || !cellule) continue;
		const titreJa = titreJaponais(cellule);
		if (!titreJa) continue;
		const date = ligne.match(/<td[^>]*class="date"[^>]*>([\s\S]*?)<\/td>/)?.[1];
		if (date) {
			const iso = date.match(/\((\d{4})-(\d{2})-(\d{2})\)/);
			derniereDate = {
				parution: iso
					? Math.floor(Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`) / 1000)
					: null,
				magazine:
					date
						.replace(/<[^>]+>/g, " ")
						.replace(/\(\d{4}-\d{2}-\d{2}\)/, "")
						.replace(/\s+/g, " ")
						.trim() || null,
			};
		}
		sortie.push({
			numero: Number(numero),
			titreJa,
			...(derniereDate ?? { parution: null, magazine: null }),
		});
	}
	return sortie;
}

/** Identifiant de révision au même format que ceux du site (24 signes base36). */
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

// -------------------------------------------------------------------- relevé

const releve = new Map<string, Chapitre[]>();
for (const { serie, url, libelle } of CORPUS) {
	if (SERIE && SERIE !== serie) continue;
	const lot = chapitres(await page(url));
	releve.set(serie, lot);
	const sansDate = lot.filter((c) => c.parution === null).length;
	console.log(
		`  ${serie} · ${libelle} : ${lot.length} chapitre(s)${sansDate ? `, dont ${sansDate} sans date` : ""}`
	);
	if (lot.length === 0)
		console.error(`  ⊘ ${url} n'a rien rendu — page déplacée ou refus du serveur.`);
}
console.log("");

// -------------------------------------------------------------- rapprochement

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	let ecrites = 0;
	let absentes = 0;
	let inchangees = 0;

	for (const [serie, lot] of releve) {
		const enBase = await sql<
			{
				id: string;
				chapter_number: string;
				title: string;
				title_ja: string | null;
				published_at: string | null;
			}[]
		>`
			SELECT id, chapter_number, title, title_ja, published_at
			FROM bot.db_manga_chapters WHERE series = ${serie} ORDER BY chapter_number`;
		// postgres-js rend les bigint en CHAÎNES : sans Number(), la clé ne s'apparie pas.
		const parNumero = new Map(enBase.map((c) => [Number(c.chapter_number), c]));

		for (const chap of lot) {
			const ligne = parNumero.get(chap.numero);
			if (!ligne) {
				absentes++;
				console.log(
					`  + ${serie} ${chap.numero} absent de la base — ${chap.titreJa} (${chap.magazine ?? "?"})`
				);
				continue;
			}
			const titreJa = RECRIRE || !ligne.title_ja ? chap.titreJa : ligne.title_ja;
			const parution = RECRIRE || !ligne.published_at ? chap.parution : Number(ligne.published_at);
			if (
				titreJa === ligne.title_ja &&
				String(parution ?? "") === String(ligne.published_at ?? "")
			) {
				inchangees++;
				continue;
			}
			ecrites++;
			if (ecrites <= 5 || ecrites % 100 === 0) {
				console.log(
					`  · ${serie} ${String(chap.numero).padStart(3)} → ${titreJa}${parution ? ` (${new Date(parution * 1000).toISOString().slice(0, 10)})` : ""}`
				);
			}
			if (!APPLIQUER) continue;
			await sql.begin(async (tx) => {
				await tx`
					UPDATE bot.db_manga_chapters
					SET title_ja = ${titreJa}, published_at = ${parution}
					WHERE id = ${Number(ligne.id)}`;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: idRevision(),
					tableName: "db_manga_chapters",
					rowId: String(ligne.id),
					action: "update",
					label: ligne.title,
					before: tx.json({
						title_ja: ligne.title_ja,
						published_at: ligne.published_at ? Number(ligne.published_at) : null,
					}),
					after: tx.json({ title_ja: titreJa, published_at: parution }),
					editorId: "agent",
					editorName: "Script ingere-chapitres-kanzenshuu (guide Kanzenshuu)",
				})}`;
			});
		}
	}

	// ------------------------------------------------ série DB : un index PAR TOME
	// Ses 42 lignes ne sont pas des chapitres mais des tomes (« Tome 1 »…). Leur
	// titre japonais et leur date sont donc ceux du volume, déjà relevés chez
	// l'éditeur — on les recopie plutôt que d'aller les chercher deux fois.
	if (!SERIE || SERIE === "DB") {
		const parTome = await sql<
			{
				id: string;
				title: string;
				title_ja: string | null;
				published_at: string | null;
				v_title_ja: string | null;
				v_published_at: string | null;
			}[]
		>`
			SELECT c.id, c.title, c.title_ja, c.published_at,
			       v.title_ja AS v_title_ja, v.published_at AS v_published_at
			FROM bot.db_manga_chapters c
			JOIN bot.db_manga_volumes v ON v.id = c.volume_id
			WHERE c.series = 'DB' ORDER BY c.chapter_number`;
		for (const ligne of parTome) {
			const titreJa = RECRIRE || !ligne.title_ja ? ligne.v_title_ja : ligne.title_ja;
			const parution =
				RECRIRE || !ligne.published_at
					? ligne.v_published_at
						? Number(ligne.v_published_at)
						: null
					: Number(ligne.published_at);
			if (!titreJa && parution === null) continue;
			if (
				titreJa === ligne.title_ja &&
				String(parution ?? "") === String(ligne.published_at ?? "")
			) {
				inchangees++;
				continue;
			}
			ecrites++;
			if (!APPLIQUER) continue;
			await sql.begin(async (tx) => {
				await tx`
					UPDATE bot.db_manga_chapters
					SET title_ja = ${titreJa}, published_at = ${parution}
					WHERE id = ${Number(ligne.id)}`;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: idRevision(),
					tableName: "db_manga_chapters",
					rowId: String(ligne.id),
					action: "update",
					label: ligne.title,
					before: tx.json({
						title_ja: ligne.title_ja,
						published_at: ligne.published_at ? Number(ligne.published_at) : null,
					}),
					after: tx.json({ title_ja: titreJa, published_at: parution }),
					editorId: "agent",
					editorName: "Script ingere-chapitres-kanzenshuu (report du tome)",
				})}`;
			});
		}
	}

	console.log(
		`\n${ecrites} ligne(s) ${APPLIQUER ? "écrite(s)" : "à écrire"}, ${inchangees} déjà à jour, ${absentes} chapitre(s) relevé(s) sans ligne en base.`
	);
	if (!APPLIQUER) console.log("Simulation — relancer avec --appliquer pour écrire.");
} finally {
	await sql.end({ timeout: 5 });
}
