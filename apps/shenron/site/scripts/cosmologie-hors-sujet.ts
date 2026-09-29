/**
 * Masque, dans `bot.db_planets`, les entrées qui ne sont **pas des lieux**.
 *
 * En renommant la rubrique « Planètes » en « Cosmologie » — la table héberge
 * légitimement des dimensions (l'Autre Monde), des demeures divines (temple du
 * Roi de Tout, Planète sacrée) et des univers entiers — deux entrées se sont
 * révélées hors sujet, et pas seulement mal nommées :
 *
 *   #45 « Moro » : la fiche décrit « un magicien et criminel de l'univers 7 »,
 *        l'antagoniste de la saga du Prisonnier de la Patrouille Galactique.
 *        C'est un PERSONNAGE, déjà présent sous `db_characters` #838. L'import
 *        s'est fié au surnom « Moro, le mangeur de planète » (星喰いのモロ).
 *   #16 « Inconnu » (不明), description « Aucune information. » : valeur de
 *        remplissage d'import, sans contenu ni référent.
 *
 * Masquage (`visible = false`), jamais de suppression — même doctrine que
 * `doublons-personnages.ts` : `--demasquer` annule tout.
 *
 *   bun apps/shenron/site/scripts/cosmologie-hors-sujet.ts             # simulation
 *   bun apps/shenron/site/scripts/cosmologie-hors-sujet.ts --appliquer
 *   bun apps/shenron/site/scripts/cosmologie-hors-sujet.ts --demasquer
 */
import postgres from "postgres";

const APPLIQUER = process.argv.includes("--appliquer");
const DEMASQUER = process.argv.includes("--demasquer");

/** Chaque entrée porte la raison qui l'exclut — vérifiable ligne à ligne. */
const HORS_SUJET: Array<{ id: number; nom: string; raison: string }> = [
	{
		id: 45,
		nom: "Moro",
		raison: "personnage (db_characters #838), pas un lieu — surnom « mangeur de planète »",
	},
	{ id: 16, nom: "Inconnu", raison: "valeur de remplissage d'import, sans contenu" },
];

const url = (await Bun.file(`${import.meta.dir}/../.env`).text())
	.split("\n")
	.filter((l) => l.startsWith("DATABASE_URL="))
	.pop()
	?.slice("DATABASE_URL=".length)
	.replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");

const sql = postgres(url);
/** État `visible` VOULU à la fin : masquer → false, démasquer → true. */
const visibiliteVoulue = DEMASQUER;
let touchees = 0;

for (const { id, nom, raison } of HORS_SUJET) {
	const [ligne] = (await sql`
		select id, name, visible from bot.db_planets where id = ${id}
	`) as unknown as Array<{ id: number; name: string; visible: boolean }>;
	if (!ligne) {
		console.log(`  #${id} introuvable — ignoré`);
		continue;
	}
	// Garde-fou : si le nom en base a changé, on ne masque pas à l'aveugle une
	// ligne dont l'identité ne correspond plus à ce qui a été vérifié.
	if (ligne.name.trim() !== nom) {
		console.log(`  #${id} s'appelle désormais « ${ligne.name} » (et non « ${nom} ») — ignoré`);
		continue;
	}
	if (ligne.visible === visibiliteVoulue) {
		console.log(`  #${id} « ${nom} » déjà ${visibiliteVoulue ? "visible" : "masqué"}`);
		continue;
	}
	touchees++;
	console.log(`  #${id} « ${nom} » → ${DEMASQUER ? "visible" : "masqué"} · ${raison}`);
	if (APPLIQUER || DEMASQUER) {
		await sql`update bot.db_planets set visible = ${visibiliteVoulue} where id = ${id}`;
	}
}

console.log(
	touchees === 0
		? "Rien à faire."
		: APPLIQUER || DEMASQUER
			? `${touchees} entrée(s) mise(s) à jour.`
			: `${touchees} entrée(s) à masquer — relancer avec --appliquer.`
);
await sql.end();
