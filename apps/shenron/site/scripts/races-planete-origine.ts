/**
 * Renseigne `bot.db_races.home_planet_id` là où le **nom japonais** le prouve.
 *
 * Les 18 races avaient toutes `home_planet_id = NULL` : la fiche de race affiche
 * donc un bloc « planète d'origine » vide, alors que `db_planets` porte les 62
 * mondes correspondants. Aucune colonne ne reliait les deux.
 *
 * Le japonais donne une correspondance qui ne se devine pas : le suffixe 人
 * (« habitant de ») s'ajoute au nom de la planète. `ナメック星人` (Namékien) est
 * littéralement « habitant de ナメック星 » (Namek). On ne rattache donc QUE les
 * races dont le nom japonais, privé de son 人 final, est exactement le nom
 * japonais d'une planète en base — ni plus, ni moins.
 *
 * Ce que ça exclut volontairement : `サイヤ人` (Saiyan) donnerait `サイヤ`, qui
 * n'est le nom d'aucune planète — leur monde s'appelle ベジータ星, et choisir
 * entre Vegeta et Sadala relève de l'éditorial, pas de la mesure. Ces races
 * restent à saisir à la main.
 *
 *   bun apps/shenron/site/scripts/races-planete-origine.ts             # simulation
 *   bun apps/shenron/site/scripts/races-planete-origine.ts --apply   (--appliquer accepté)
 *
 * Chaque rattachement est versionné dans `public.wiki_revisions` (une révision par race)
 * et n'écrit que si `home_planet_id` est encore vide — cf. `_fill-meta.ts`. À relancer
 * après `fill-planets-names.ts`, qui ajoute des noms japonais de planètes.
 */
import postgres from "postgres";
import { APPLY, applyChanges, type FieldChange } from "./_fill-meta";

const APPLIQUER = APPLY;

/** Le nom japonais d'une planète, tel qu'il apparaît dans une race gentilée. */
function planeteAttendue(raceJa: string): string | null {
	const nettoye = raceJa.trim();
	if (!nettoye.endsWith("人")) return null;
	const base = nettoye.slice(0, -1);
	return base.length >= 2 ? base : null;
}

const url = (await Bun.file(`${import.meta.dir}/../.env`).text())
	.split("\n")
	.filter((l) => l.startsWith("DATABASE_URL="))
	.pop()
	?.slice("DATABASE_URL=".length)
	.replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");

const sql = postgres(url);
const races = (await sql`
	select id, slug, name, name_ja from bot.db_races where visible and home_planet_id is null
`) as unknown as Array<{ id: number; slug: string; name: string; name_ja: string | null }>;
const planetes = (await sql`
	select id, name, name_ja from bot.db_planets where visible and name_ja is not null
`) as unknown as Array<{ id: number; name: string; name_ja: string }>;

const parJa = new Map<string, { id: number; name: string }>();
for (const p of planetes) {
	// Certaines planètes portent plusieurs graphies séparées par une virgule.
	for (const graphie of p.name_ja.split(/[,、]/)) {
		const cle = graphie.trim();
		if (cle && !parJa.has(cle)) parJa.set(cle, { id: p.id, name: p.name });
	}
}

let total = 0;
const changes: FieldChange[] = [];
for (const r of races) {
	if (!r.name_ja) continue;
	const attendue = planeteAttendue(r.name_ja);
	if (!attendue) continue;
	const planete = parJa.get(attendue);
	if (!planete) continue;
	total++;
	console.log(`  ${r.name} (${r.name_ja}) → ${planete.name} (${attendue})`);
	changes.push({
		table: "db_races",
		id: Number(r.id),
		label: r.name,
		after: { home_planet_id: Number(planete.id) },
		source: `races-planete-origine : ${r.name_ja} = habitant de ${attendue} (db_planets#${planete.id})`,
	});
}

if (APPLIQUER && changes.length) await applyChanges(sql, changes, "races-planete-origine");
console.log(
	total === 0
		? "Aucune race supplémentaire ne se rattache par le nom japonais."
		: APPLIQUER
			? `${total} race(s) rattachée(s) à leur planète.`
			: `${total} race(s) rattachables — relancer avec --appliquer.`
);
await sql.end();
