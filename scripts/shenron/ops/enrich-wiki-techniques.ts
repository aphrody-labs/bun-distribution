#!/usr/bin/env bun
/**
 * enrich-wiki-techniques.ts — Rétablissement canonique des créateurs,
 * noms japonais officiels et ajout du Mafuba dans bot.db_techniques.
 */
import postgres from "postgres";

const sql = postgres(process.env.REMOTE_DATABASE_URL!, { max: 1 });

console.log("1. Insertion canonique du Mafuba...");
await sql`
	INSERT INTO bot.db_techniques (
		id, slug, name, name_ja, name_romaji, type, creator_id, description,
		debut_chapter_id, article, article_sources, visible
	) VALUES (
		831, 'mafuba', 'Mafūba (Vague d''emprisonnement du démon)', '魔封波', 'Mafūba',
		'Special', 855, 'Technique mystique suprême créée par Maître Mutaito pour sceller le Roi Démon Piccolo dans un autocuiseur électronique au prix de sa vie. Transmise à Kamé Sennin et Tenshinhan, puis reprise par Gokū et Trunks.',
		135,
		'**Le Mafūba** (魔封波, littéralement « Vague de scellement démoniaque ») est une technique ésotérique ancestrale inventée par **Maître Mutaito**, le maître de Kamé Sennin et Tsuru Sennin.\n\n## Le sacrifice fondateur de Mutaito\n\nDes siècles avant le début de Dragon Ball, lorsque le Roi Démon Piccolo mit la Terre à feu et à sang, aucune force physique ne pouvait l''abattre. Mutaito s''isola dans les montagnes pour développer une technique capable de convertir son énergie vitale en un tourbillon d''énergie spirale aspirant le démon pour l''enfermer dans un récipient scellé d''un talisman magique (*Ofuda*). La technique coûta la vie à Mutaito mais sauva le monde.\n\n## Une technique légendaire\n\nElle fut réutilisée avec bravoure par **Kamé Sennin** (qui y laissa également la vie au tome 12), puis maîtrisée par **Tenshinhan**, et enfin réenseignée par Kamé Sennin à **Son Gokū** dans *Dragon Ball Super* pour tenter d''emprisonner le corps immortel de Zamasu.',
		${JSON.stringify([{ n: 1, url: "/wiki/manga/volume/12", kind: "manga_volume", label: "Manga Dragon Ball — Tome 12, Chapitres 135-146" }])},
		true
	)
	ON CONFLICT (id) DO UPDATE SET
		slug = EXCLUDED.slug,
		name = EXCLUDED.name,
		name_ja = EXCLUDED.name_ja,
		name_romaji = EXCLUDED.name_romaji,
		type = EXCLUDED.type,
		creator_id = EXCLUDED.creator_id,
		description = EXCLUDED.description,
		debut_chapter_id = EXCLUDED.debut_chapter_id,
		article = EXCLUDED.article,
		article_sources = EXCLUDED.article_sources,
		visible = EXCLUDED.visible;
`;
console.log("  ✓ Mafūba inséré avec creator_id: 855 (Mutaito).");

// Lier le Mafuba dans bot.db_character_techniques
const mafubaUsers = [855, 17, 12, 1]; // Mutaito, Master Roshi, Tenshinhan, Goku
for (const uid of mafubaUsers) {
	await sql`
		INSERT INTO bot.db_character_techniques (character_id, technique_id)
		VALUES (${uid}, 831)
		ON CONFLICT DO NOTHING;
	`;
}
console.log("  ✓ Mafūba lié à Mutaito, Master Roshi, Tenshinhan et Goku.");

// 2. Mises à jour des techniques majeures
const TECH_UPDATES = [
	{ id: 114, creator_id: 17, ja: "かめはめ波", ro: "Kamehameha", type: "kikoha" },
	{ id: 115, creator_id: 1, ja: "超かめはめ波", ro: "Chō Kamehameha", type: "ultimate" },
	{ id: 128, creator_id: 63, ja: "元気玉", ro: "Genkidama", type: "ultimate" },
	{ id: 129, creator_id: null, ja: "瞬間移動", ro: "Shunkan Idō", type: "support" },
	{ id: 136, creator_id: 1, ja: "10倍かめはめ波", ro: "Jūbai Kamehameha", type: "ultimate" },
	{ id: 138, creator_id: 1142, ja: "ジャン拳", ro: "Jan-ken", type: "corps-a-corps" },
	{ id: 147, creator_id: 3, ja: "魔閃光", ro: "Masenkō", type: "kikoha" },
	{ id: 159, creator_id: 11, ja: "気円斬", ro: "Kienzan", type: "kikoha" },
	{ id: 160, creator_id: 63, ja: "界王拳", ro: "Kaiōken", type: "amplification" },
	{ id: 161, creator_id: 63, ja: "3倍界王拳", ro: "Sanbai Kaiōken", type: "amplification" },
	{ id: 162, creator_id: 63, ja: "20倍界王拳", ro: "Nijūbai Kaiōken", type: "amplification" },
	{ id: 166, creator_id: 13, ja: "狼牙風風拳", ro: "Rōgafūfūken", type: "corps-a-corps" },
	{ id: 171, creator_id: 17, ja: "残像拳", ro: "Zanzōken", type: "support" },
	{ id: 173, creator_id: 1238, ja: "どどん波", ro: "Dodonpa", type: "kikoha" },
	{ id: 174, creator_id: 1238, ja: "気功砲", ro: "Kikōhō", type: "kikoha" },
	{ id: 175, creator_id: 12, ja: "排球拳", ro: "Haikyūken", type: "corps-a-corps" },
	{ id: 176, creator_id: 1238, ja: "太陽拳", ro: "Taiyōken", type: "support" },
	{ id: 188, creator_id: 2, ja: "ギャリック砲", ro: "Gyarikku Hō", type: "kikoha" },
	{ id: 262, creator_id: 2, ja: "ビッグバンアタック", ro: "Biggu Ban Atakku", type: "kikoha" },
	{ id: 337, creator_id: 13, ja: "新狼牙風風拳", ro: "Shin Rōgafūfūken", type: "corps-a-corps" },
	{ id: 454, creator_id: 2, ja: "ファイナルフラッシュ", ro: "Fainaru Furasshu", type: "ultimate" },
	{ id: 494, creator_id: 3, ja: "魔貫光殺砲", ro: "Makankōsappō", type: "ultimate" },
	{ id: 562, creator_id: 10, ja: "親子かめはめ波", ro: "Oyako Kamehameha", type: "ultimate" },
	{ id: 567, creator_id: 13, ja: "操気弾", ro: "Sōkidan", type: "kikoha" },
	{ id: 568, creator_id: 12, ja: "新気功砲", ro: "Shin Kikōhō", type: "ultimate" },
	{ id: 617, creator_id: 1, ja: "瞬間移動かめはめ波", ro: "Shunkan Idō Kamehameha", type: "ultimate" },
	{ id: 620, creator_id: 1, ja: "龍拳", ro: "Ryūken", type: "ultimate" },
	{ id: 621, creator_id: 1, ja: "4倍界王拳かめはめ波", ro: "Yonbai Kaiōken Kamehameha", type: "ultimate" },
	{ id: 622, creator_id: 1, ja: "20倍界王拳かめはめ波", ro: "Nijūbai Kaiōken Kamehameha", type: "ultimate" },
	{ id: 632, creator_id: 66, ja: "ファイナルかめはめ波", ro: "Fainaru Kamehameha", type: "ultimate" },
	{ id: 780, creator_id: null, ja: "身勝手の極意", ro: "Migatte no Gokui", type: "divin" },
];

console.log("2. Mise à jour des créateurs et graphies japonaises des techniques canon...");
for (const u of TECH_UPDATES) {
	await sql`
		UPDATE bot.db_techniques SET
			creator_id = ${u.creator_id},
			name_ja = ${u.ja},
			name_romaji = ${u.ro},
			type = ${u.type}
		WHERE id = ${u.id};
	`;
}

console.log(`  ✓ ${TECH_UPDATES.length} techniques re-ancrées avec créateurs et noms japonais.`);
await sql.end();
