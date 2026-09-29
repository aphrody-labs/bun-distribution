/**
 * Réécrit les anciens chemins `/wiki/dragon-ball/…` stockés EN BASE.
 *
 * Les fiches ont été rapatriées sous le segment de leur index
 * (`/wiki/personnages/12`, `/wiki/planetes/3`, `/wiki/techniques/kamehameha`).
 * Les URL déjà publiées sont récupérées par des 308 dans `next.config`, mais un
 * lien écrit dans un article ou dans une carte « page affiliée » n'a aucune
 * raison de coûter une redirection à chaque clic : on met la base au chemin
 * canonique.
 *
 * Mesuré au 2026-08-25 : 5 lignes concernées (2 articles de personnage, 2 corps
 * de section, 1 carte de lien). Le script est idempotent — le relancer ne fait
 * rien de plus.
 *
 *   bun apps/site/scripts/chemins-wiki-canoniques.ts            # simulation
 *   bun apps/site/scripts/chemins-wiki-canoniques.ts --appliquer
 */
import postgres from "postgres";

const APPLIQUER = process.argv.includes("--appliquer");

const REMPLACEMENTS: Array<[RegExp, string]> = [
	[/\/wiki\/dragon-ball\/character\//g, "/wiki/personnages/"],
	[/\/wiki\/dragon-ball\/planet\//g, "/wiki/planetes/"],
	[/\/wiki\/dragon-ball\/techniques/g, "/wiki/techniques"],
	// Ancien index fourre-tout : déjà 308 vers la page Personnages.
	[/\/wiki\/dragon-ball(?![/\w])/g, "/wiki/personnages"],
];

function canonique(texte: string): string {
	return REMPLACEMENTS.reduce((acc, [de, vers]) => acc.replace(de, vers), texte);
}

/** Une colonne texte à balayer : table, clé primaire, colonne. */
const CIBLES: Array<{ table: string; colonne: string }> = [
	{ table: "bot.db_characters", colonne: "article" },
	{ table: "bot.db_planets", colonne: "article" },
	{ table: "bot.db_races", colonne: "article" },
	{ table: "bot.db_sagas", colonne: "article" },
	{ table: "bot.db_arcs", colonne: "article" },
	{ table: "bot.db_techniques", colonne: "article" },
	{ table: "bot.db_transformations", colonne: "article" },
	{ table: "bot.db_games", colonne: "article" },
	{ table: "bot.db_wiki_sections", colonne: "body" },
	// `links` est du jsonb : on le traite comme du texte, la forme est préservée
	// puisque seuls des chemins internes changent à l'intérieur des chaînes.
	{ table: "bot.db_wiki_sections", colonne: "links" },
];

const url = (await Bun.file(`${import.meta.dir}/../.env`).text())
	.split("\n")
	.filter((l) => l.startsWith("DATABASE_URL="))
	.pop()
	?.slice("DATABASE_URL=".length)
	.replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL introuvable dans apps/site/.env");

const sql = postgres(url);
let total = 0;

for (const { table, colonne } of CIBLES) {
	const jsonb = colonne === "links";
	const lecture = jsonb ? `${colonne}::text` : colonne;
	// Toutes les tables n'ont pas la colonne : `db_games` n'a pas d'`article`.
	// Une table sans la colonne n'est pas une erreur, c'est une cible qui ne la
	// concerne pas — on la saute plutôt que d'interrompre le balayage.
	const [{ existe }] = (await sql`
		select count(*) > 0 as existe from information_schema.columns
		where table_schema = ${table.split(".")[0]!}
			and table_name = ${table.split(".")[1]!}
			and column_name = ${colonne}
	`) as unknown as Array<{ existe: boolean }>;
	if (!existe) continue;

	const lignes = await sql.unsafe(
		`select id, ${lecture} as valeur from ${table} where ${lecture} like '%/wiki/dragon-ball%'`
	);
	for (const ligne of lignes as unknown as Array<{ id: number; valeur: string }>) {
		const avant = ligne.valeur;
		const apres = canonique(avant);
		if (apres === avant) continue;
		total++;
		console.log(`  ${table}.${colonne} #${ligne.id}`);
		if (!APPLIQUER) continue;
		if (jsonb) {
			await sql.unsafe(`update ${table} set ${colonne} = $1::jsonb where id = $2`, [
				apres,
				ligne.id,
			]);
		} else {
			await sql.unsafe(`update ${table} set ${colonne} = $1 where id = $2`, [apres, ligne.id]);
		}
	}
}

console.log(
	total === 0
		? "Rien à réécrire : la base est déjà au chemin canonique."
		: APPLIQUER
			? `${total} valeur(s) réécrite(s).`
			: `${total} valeur(s) à réécrire — relancer avec --appliquer.`
);
await sql.end();
