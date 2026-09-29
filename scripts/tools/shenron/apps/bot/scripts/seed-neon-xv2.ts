/**
 * seed-neon-xv2.ts — pousse la donnée wiki Xenoverse 2 dans NEON (source éditoriale).
 *
 * Le bot lit un réplica SQLite rafraîchi depuis Neon (DELETE+INSERT toutes les 15 min) :
 * la donnée wiki doit donc vivre dans Neon (schéma pg `bot.*`), pas seulement en SQLite.
 * Ce script lit la SQLite locale DÉJÀ seedée (via db:seed-xv2-all) et réplique
 * additivement vers Neon, en résolvant les relations par NOM (les id divergent).
 *
 * Idempotent. Additif : ne supprime que ses propres données (techniques typées XV2,
 * transfos/liens XV2), jamais les entrées éditoriales du site.
 *
 *   SRC=./data/bot.db DATABASE_URL=postgres://… bun scripts/seed-neon-xv2.ts
 */
import { Database } from "bun:sqlite";
import postgres from "postgres";

const SRC = process.env.SRC ?? "./data/bot.db";
const NEON = process.env.DATABASE_URL;
if (!NEON) throw new Error("DATABASE_URL (Neon) requis");

const lite = new Database(SRC, { readonly: true });
const sql = postgres(NEON, { max: 4, prepare: false });
const q = <T = any>(s: string): T[] => lite.query(s).all() as T[];

// 1) schéma : colonne portrait_xv2 (additive) — tables dans le schéma pg `bot`
await sql`ALTER TABLE bot.db_characters ADD COLUMN IF NOT EXISTS portrait_xv2 text`;

// 2) PERSONNAGES — upsert par nom (les originaux gardent leur ligne ; +XV2 insérés)
const neonChars = await sql`select id, name from bot.db_characters`;
const charId = new Map<string, number>(neonChars.map((r: any) => [r.name, r.id]));
let chUpd = 0,
	chIns = 0;
for (const c of q("select name,image,portrait_xv2,race,gender,description from db_characters")) {
	if (charId.has(c.name)) {
		await sql`update bot.db_characters set portrait_xv2 = ${c.portrait_xv2},
			race = coalesce(race, ${c.race}), gender = coalesce(gender, ${c.gender})
			where name = ${c.name}`;
		chUpd++;
	} else {
		const [row]: any = await sql`insert into bot.db_characters
			(name, image, portrait_xv2, race, gender, description)
			values (${c.name}, ${c.image}, ${c.portrait_xv2}, ${c.race}, ${c.gender}, ${c.description})
			returning id`;
		charId.set(c.name, row.id);
		chIns++;
	}
}
console.log(`personnages : ${chUpd} maj, ${chIns} insérés`);

// 3) TECHNIQUES — insère les XV2 (slug absent) ; map nom -> id
const neonTechSlugs = new Set(
	(await sql`select slug from bot.db_techniques`).map((r: any) => r.slug)
);
let tIns = 0;
for (const t of q(
	"select slug,name,type,description from db_techniques where type in ('super','ultimate','awoken','evasive')"
)) {
	if (neonTechSlugs.has(t.slug)) continue;
	await sql`insert into bot.db_techniques (slug, name, type, description)
		values (${t.slug}, ${t.name}, ${t.type}, ${t.description})`;
	tIns++;
}
const techId = new Map<string, number>(
	(await sql`select id, name from bot.db_techniques`).map((r: any) => [r.name, r.id])
);
console.log(`techniques : ${tIns} insérées`);

// 4) TRANSFORMATIONS XV2 — purge des nôtres puis ré-insert (char par nom)
await sql`delete from bot.db_transformations where image like '%xv2-portraits%'`;
const liteCharName = new Map<number, string>(
	q<{ id: number; name: string }>("select id,name from db_characters").map((r) => [r.id, r.name])
);
let trIns = 0;
for (const tr of q(
	"select name,image,ki,character_id from db_transformations where image like '%xv2-portraits%'"
)) {
	const cn = liteCharName.get(tr.character_id);
	const cid = cn && charId.get(cn);
	if (!cid) continue;
	await sql`insert into bot.db_transformations (name, image, ki, character_id)
		values (${tr.name}, ${tr.image}, ${tr.ki}, ${cid})`;
	trIns++;
}
console.log(`transformations XV2 : ${trIns} insérées`);

// 5) LIENS perso↔technique — purge des liens XV2 + DÉDUP (pas de contrainte unique
//    sur Neon → on déduplique d'abord toute la table), puis ré-insert des seuls liens XV2.
const neonXv2TechIds = (await sql`select id from bot.db_techniques where type is not null`).map(
	(r: any) => r.id
);
if (neonXv2TechIds.length)
	await sql`delete from bot.db_character_techniques where technique_id = any(${neonXv2TechIds})`;
// dédup défensive (nettoie d'éventuels doublons d'un run antérieur)
await sql`delete from bot.db_character_techniques a using bot.db_character_techniques b
	where a.ctid < b.ctid and a.character_id = b.character_id and a.technique_id = b.technique_id`;
const liteTechName = new Map<number, string>(
	q<{ id: number; name: string }>("select id,name from db_techniques").map((r) => [r.id, r.name])
);
// seuls les liens vers une technique XV2 (typée) sont gérés ici — ne PAS toucher aux liens curés
let lIns = 0,
	lSkip = 0;
const seen = new Set<string>();
for (const l of q<{ character_id: number; technique_id: number }>(
	"select character_id, technique_id from db_character_techniques where technique_id in (select id from db_techniques where type is not null)"
)) {
	const cn = liteCharName.get(l.character_id);
	const tn = liteTechName.get(l.technique_id);
	const cid = cn && charId.get(cn);
	const tid = tn && techId.get(tn);
	if (!cid || !tid) {
		lSkip++;
		continue;
	}
	const key = `${cid}:${tid}`;
	if (seen.has(key)) continue;
	seen.add(key);
	await sql`insert into bot.db_character_techniques (character_id, technique_id) values (${cid}, ${tid})
		on conflict do nothing`;
	lIns++;
}
console.log(`liens perso↔technique : ${lIns} insérés (${lSkip} non résolus)`);

const totals = {
	chars: (await sql`select count(*)::int n from bot.db_characters`)[0].n,
	techs: (await sql`select count(*)::int n from bot.db_techniques`)[0].n,
	transfos: (await sql`select count(*)::int n from bot.db_transformations`)[0].n,
	links: (await sql`select count(*)::int n from bot.db_character_techniques`)[0].n,
};
console.log("Neon totaux:", totals);
await sql.end();
lite.close();
