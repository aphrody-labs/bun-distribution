/**
 * Détecte les **planètes en double** dans `bot.db_planets`.
 *
 * La table mélange deux imports : l'un nomme les mondes tels qu'ils sont cités
 * dans l'œuvre et porte leur nom japonais (`Namek` / ナメック星, `Vegeta` /
 * ベジータ星, `Terre` / 地球), l'autre les préfixe de « Planète » sans nom
 * japonais (`Planète Namek`, `Planète Vegeta`, `Planète Terre`). Résultat : le
 * site annonce 62 mondes dont une dizaine comptés deux fois, chacun avec sa
 * propre fiche et son propre article.
 *
 * Ce script **ne masque rien**. Contrairement aux doublons de personnages —
 * tranchés par l'égalité des noms japonais — les deux entrées portent ici un
 * article long et distinct (4 à 5 Ko chacun) : choisir revient à jeter du texte
 * rédigé, ce qui demande de les lire. Le script sert donc à cadrer ce travail :
 * il dit quelles paires existent et ce que chacune contient.
 *
 *   bun apps/shenron/site/scripts/doublons-planetes.ts
 */
import postgres from "postgres";

/** « Planète de Beerus », « Planète Beerus », « Beerus » → « beerus ». */
function noyau(nom: string): string {
	return (
		nom
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/^(planete|etoile)\s+(de\s+|du\s+|des\s+|d')?/, "")
			// La parenthèse est retirée SAUF quand elle nomme un univers : « Planète
			// Kaishin (Univers 7) », « (Univers 10) » et « (Univers 11) » sont trois
			// mondes distincts, pas trois saisies du même. Les confondre ferait dire au
			// script l'inverse de ce qu'il doit établir.
			.replace(/\s*\((?!\s*univers)[^)]*\)$/i, "")
			.replace(/[^a-z0-9]+/g, " ")
			.trim()
	);
}

const url = (await Bun.file(`${import.meta.dir}/../.env`).text())
	.split("\n")
	.filter((l) => l.startsWith("DATABASE_URL="))
	.pop()
	?.slice("DATABASE_URL=".length)
	.replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");

const sql = postgres(url);
const lignes = (await sql`
	select id, name, name_ja,
		coalesce(length(description), 0) as taille_description,
		coalesce(length(article), 0) as taille_article
	from bot.db_planets where visible order by id
`) as unknown as Array<{
	id: number;
	name: string;
	name_ja: string | null;
	taille_description: number;
	taille_article: number;
}>;

const groupes = new Map<string, typeof lignes>();
for (const l of lignes) {
	const cle = noyau(l.name);
	if (!cle) continue;
	groupes.set(cle, [...(groupes.get(cle) ?? []), l]);
}

let paires = 0;
for (const [cle, membres] of [...groupes].toSorted()) {
	if (membres.length < 2) continue;
	paires++;
	console.log(`\n« ${cle} » — ${membres.length} fiches`);
	for (const m of membres) {
		console.log(
			`   #${String(m.id).padStart(3)} ${m.name.padEnd(34)} ja=${(m.name_ja ?? "—").padEnd(14)} ` +
				`description ${String(m.taille_description).padStart(4)} · article ${String(m.taille_article).padStart(5)}`
		);
	}
}

console.log(
	`\n${paires} groupe(s) en double sur ${lignes.length} planètes visibles.` +
		"\nAucune modification faite : la fusion demande de lire les deux articles."
);
await sql.end();
