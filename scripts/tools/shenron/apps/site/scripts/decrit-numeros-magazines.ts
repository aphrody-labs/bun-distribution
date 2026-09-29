#!/usr/bin/env bun
/**
 * Description des NUMÉROS DE MAGAZINE de `bot.db_databooks`.
 *
 * Sur les 370 ouvrages du fonds, 284 n'avaient aucune description — et 267
 * d'entre eux sont des numéros de périodique (V Jump, Saikyō Jump, Weekly
 * Shōnen Jump). Ceux-là ne se rédigent pas un par un : il n'y a rien à en dire
 * qu'on puisse sourcer, sinon ce que la base sait déjà d'eux. Ce script compose
 * donc leur description à partir des SEULS faits en base — périodicité,
 * éditeur, date de parution, nombre de planches numérisées — et ne dit rien
 * d'autre. Aucune phrase n'est inventée, aucune n'est identique à sa voisine :
 * la date et le volume numérisé distinguent chaque numéro.
 *
 * Les ouvrages de référence (Daizenshuu, Chōzenshū, artbooks, guides, anime
 * comics, notices de jeu, programmes de festival) sont HORS de ce script :
 * ceux-là ont un contenu propre et se rédigent à la main.
 *
 * ON DIT « MIS EN VENTE », JAMAIS « PARU EN », et ce n'est pas une nuance de
 * style. Mesuré le 2026-09-03 sur les 245 numéros dont le titre porte un mois :
 * **240 ne concordent pas** avec `published_at` — 162 avec deux mois d'écart,
 * 78 avec un. La base n'est pas fautive, c'est la convention japonaise : un
 * mensuel daté « juillet 1993 » en couverture est mis en vente en mai 1993, et
 * `published_at` enregistre la mise en vente. Écrire « paru en mai 1993 » sur
 * une fiche dont le titre affiche « Juillet 1993 » se contredirait à l'écran,
 * sur la même page — le premier jet de ce script le faisait.
 *
 * SIMULATION PAR DÉFAUT. Chaque écriture passe par `public.wiki_revisions`,
 * donc tout est réversible depuis `/admin/wiki/history`.
 *
 * Usage :
 *   bun scripts/decrit-numeros-magazines.ts                    # simulation, tout le reste
 *   bun scripts/decrit-numeros-magazines.ts --categorie V-Jump # une seule collection
 *   bun scripts/decrit-numeros-magazines.ts --limite 5         # un échantillon, pour relire
 *   bun scripts/decrit-numeros-magazines.ts --appliquer
 *   bun scripts/decrit-numeros-magazines.ts --recrire          # réécrit aussi les fiches déjà décrites
 */
import { join } from "node:path";
import postgres from "postgres";
import { arretSiGel } from "./_databooks-base";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const APPLIQUER = flag("appliquer");
const RECRIRE = flag("recrire");
const CATEGORIE = opt("categorie");
const LIMITE = Number(opt("limite", "0"));

// Même une simulation est un écrivain potentiel : refuser avant `urlBase()` et
// avant que postgres-js ne crée une connexion rend le gel vérifiable.
arretSiGel("decrit-numeros-magazines");

/**
 * Ce que chaque périodique est, en une proposition vérifiable — et si sa date
 * de parution se dit au jour (hebdomadaire) ou au mois (mensuel).
 */
const PERIODIQUES: Record<string, { phrase: string; auJour: boolean }> = {
	"V-Jump": { phrase: "Numéro du mensuel *V Jump* (Shueisha)", auJour: false },
	"Saikyō Jump": { phrase: "Numéro du *Saikyō Jump* (Shueisha)", auJour: false },
	"Weekly Shonen Jump": {
		phrase: "Numéro de l'hebdomadaire *Weekly Shōnen Jump* (Shueisha)",
		auJour: true,
	},
};

const MOIS = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre",
];

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

/** `published_at` est un bigint : postgres-js le rend en CHAÎNE, d'où le Number(). */
function dateFr(secondes: number | string | null, auJour: boolean): string | null {
	const n = Number(secondes);
	if (!Number.isFinite(n) || n <= 0) return null;
	const d = new Date(n * 1000);
	const mois = MOIS[d.getUTCMonth()];
	if (!mois) return null;
	return auJour
		? `le ${d.getUTCDate()} ${mois} ${d.getUTCFullYear()}`
		: `en ${mois} ${d.getUTCFullYear()}`;
}

function dateCompatibleAvecTitre(title: string, secondes: number | string | null): boolean {
	const year = /\b(?:19|20)\d{2}\b/.exec(title)?.[0];
	const timestamp = Number(secondes);
	if (!year || !Number.isFinite(timestamp) || timestamp <= 0) return true;
	return Math.abs(new Date(timestamp * 1000).getUTCFullYear() - Number(year)) <= 1;
}

function composer(
	title: string,
	categorie: string,
	publie: number | string | null,
	planches: number
): string | null {
	const p = PERIODIQUES[categorie];
	if (!p) return null;
	const quand = dateCompatibleAvecTitre(title, publie) ? dateFr(publie, p.auJour) : null;
	const tete = quand ? `${p.phrase}, mis en vente ${quand}.` : `${p.phrase}.`;
	const fonds =
		planches > 0
			? ` Le fonds en conserve ${planches} planche${planches > 1 ? "s" : ""} numérisée${planches > 1 ? "s" : ""}.`
			: " Aucune planche de ce numéro n'est encore numérisée dans le fonds.";
	return tete + fonds;
}

/** Identifiant de révision au même format que ceux du site (24 signes base36). */
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	const categories = CATEGORIE ? [CATEGORIE] : Object.keys(PERIODIQUES);
	for (const c of categories) {
		if (!PERIODIQUES[c]) throw new Error(`catégorie sans périodique connu : ${c}`);
	}

	const lignes = await sql<
		{
			id: number;
			title: string;
			category: string;
			published_at: string | null;
			planches: number;
			description: string | null;
		}[]
	>`
		SELECT id, title, category, published_at,
		       jsonb_array_length(coalesce(pages, '[]'::jsonb))::int AS planches,
		       description
		FROM bot.db_databooks
		WHERE visible IS NOT FALSE
		  AND category IN ${sql(categories)}
		  ${RECRIRE ? sql`` : sql`AND (description IS NULL OR btrim(description) = '')`}
		ORDER BY category, published_at, id`;

	const cibles = LIMITE > 0 ? lignes.slice(0, LIMITE) : lignes;
	console.log(
		`${cibles.length} numéro(s) à décrire${LIMITE > 0 ? ` (sur ${lignes.length})` : ""}.\n`
	);

	let posees = 0;
	for (const l of cibles) {
		const texte = composer(l.title, l.category, l.published_at, l.planches);
		if (!texte) {
			console.log(`  ⊘ ${l.id} — catégorie non gérée : ${l.category}`);
			continue;
		}
		console.log(`  ${String(l.id).padStart(4)} ${l.title.slice(0, 46).padEnd(46)} → ${texte}`);
		if (!APPLIQUER) continue;

		await sql.begin(async (tx) => {
			await tx`UPDATE bot.db_databooks SET description = ${texte} WHERE id = ${l.id}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_databooks",
				rowId: String(l.id),
				action: "update",
				label: l.title,
				before: tx.json({ description: l.description ?? null }),
				after: tx.json({ description: texte }),
				editorId: "agent",
				editorName: "Script decrit-numeros-magazines (faits de la base)",
			})}`;
		});
		posees++;
	}

	console.log(
		APPLIQUER
			? `\n✔ ${posees} description(s) déposée(s) et versionnée(s).`
			: "\n(simulation — relancer avec --appliquer)"
	);
} catch (e) {
	console.error("✗", e instanceof Error ? e.message : e);
	process.exitCode = 1;
} finally {
	await sql.end();
}
