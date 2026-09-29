#!/usr/bin/env bun
/**
 * enrich-wiki-characters.ts — Correction et enrichissement des personnages
 * sans nom japonais, sans genre ou sans planète d'origine (Daizenshuu 7 / 42 tomes Toriyama).
 */
import postgres from "postgres";

const sql = postgres(process.env.REMOTE_DATABASE_URL!, { max: 1 });

const CHAR_UPDATES = [
	{ id: 81, ja: "カイワレマン", ro: "Kaiwareman", race: "Saibaiman", gender: "Male", planet: 3 },
	{ id: 85, ja: "リクーム", ro: "Rikūmu", race: "Alien", gender: "Male", planet: 4 },
	{ id: 87, ja: "超17号", ro: "Chō Jū Nana-gō", race: "Android", gender: "Male", planet: 2 },
	{ id: 88, ja: "セルジュニア", ro: "Seru Junia", race: "Android / Bio-Warrior", gender: "Male", planet: 2 },
	{ id: 92, ja: "三星龍", ro: "San Shinron", race: "Shadow Dragon", gender: "Male", planet: 2 },
	{ id: 93, ja: "四星龍", ro: "Sū Shinron", race: "Shadow Dragon", gender: "Male", planet: 2 },
	{ id: 94, ja: "一星龍", ro: "Ī Shinron", race: "Shadow Dragon", gender: "Male", planet: 2 },
	{ id: 96, ja: "時の界王神 (クロノア)", ro: "Toki no Kaiōshin (Kuronoa)", race: "Shinjin", gender: "Female", planet: 35 },
	{ id: 97, ja: "ナバナ", ro: "Nabana", race: "Alien", gender: "Male", planet: 4 },
	{ id: 98, ja: "ラズベリー", ro: "Razuberī", race: "Alien", gender: "Male", planet: 4 },
	{ id: 99, ja: "ミラ", ro: "Mira", race: "Android / Demon", gender: "Male", planet: 66 },
	{ id: 100, ja: "トワ", ro: "Towa", race: "Demon", gender: "Female", planet: 66 },
	{ id: 101, ja: "ジャコ・ティリメンテンピボッシ", ro: "Jako Tirimentenpibosshi", race: "Alien", gender: "Male", planet: 7 },
	{ id: 104, ja: "ターレス", ro: "Tāresu", race: "Saiyan", gender: "Male", planet: 3 },
	{ id: 105, ja: "スラッグ", ro: "Suraggu", race: "Namekian", gender: "Male", planet: 1 },
	{ id: 106, ja: "ヒット", ro: "Hitto", race: "Alien (Univers 6)", gender: "Male", planet: null },
	{ id: 107, ja: "老界王神", ro: "Rō Kaiōshin", race: "Shinjin", gender: "Male", planet: 35 },
	{ id: 109, ja: "未来のトランクス", ro: "Mirai no Torankusu", race: "Saiyan / Human", gender: "Male", planet: 2 },
	{ id: 110, ja: "フロスト", ro: "Furosuto", race: "Frieza Race (Univers 6)", gender: "Male", planet: null },
	{ id: 111, ja: "キャベ", ro: "Kyabe", race: "Saiyan (Univers 6)", gender: "Male", planet: 55 },
	{ id: 113, ja: "シャンパ", ro: "Shanpa", race: "Dieu de la Destruction", gender: "Male", planet: null },
	{ id: 114, ja: "ザマス", ro: "Zamasu", race: "Shinjin", gender: "Male", planet: 37 },
	{ id: 115, ja: "ボージャック", ro: "Bōjakku", race: "Hera-seijin", gender: "Male", planet: null },
	{ id: 116, ja: "合体ザマス", ro: "Gattai Zamasu", race: "Shinjin / Saiyan", gender: "Male", planet: 37 },
	{ id: 118, ja: "タピオン", ro: "Tapion", race: "Konatsian", gender: "Male", planet: 26 },
	{ id: 119, ja: "フュー", ro: "Fyū", race: "Demon / Artificial", gender: "Male", planet: 66 },
	{ id: 120, ja: "スーパーベビー2", ro: "Sūpā Bebī Tsū", race: "Machine Mutant / Tsuful", gender: "Male", planet: 23 },
	{ id: 121, ja: "リブリアン", ro: "Riburian", race: "Humanoid (Univers 2)", gender: "Female", planet: null },
	{ id: 122, ja: "スーパーウーブ", ro: "Majin Ūbu", race: "Human / Majin", gender: "Male", planet: 2 },
	{ id: 125, ja: "ガンマ1号", ro: "Ganma Ichi-gō", race: "Android", gender: "Male", planet: 2 },
	{ id: 126, ja: "ガンマ2号", ro: "Ganma Ni-gō", race: "Android", gender: "Male", planet: 2 },
	{ id: 128, ja: "セルMAX", ro: "Seru Makkusu", race: "Android", gender: "Male", planet: 2 },
	// Données additionnelles sur personnages majeurs
	{ id: 80, ja: "ビーデル", ro: "Bīderu", race: "Human", gender: "Female", planet: 2 },
	{ id: 79, ja: "孫悟天", ro: "Son Goten", race: "Saiyan / Human", gender: "Male", planet: 2 },
	{ id: 91, ja: "パン", ro: "Pan", race: "Saiyan / Human", gender: "Female", planet: 2 },
	{ id: 253, ja: "ブラ", ro: "Bura", race: "Saiyan / Human", gender: "Female", planet: 2 },
	{ id: 78, ja: "キビト", ro: "Kibito", race: "Shinjin", gender: "Male", planet: 35 },
	{ id: 34, ja: "ウイス", ro: "Uisu", race: "Angel", gender: "Male", planet: null },
	{ id: 112, ja: "ヴァドス", ro: "Vadosu", race: "Angel", gender: "Female", planet: null },
	{ id: 44, ja: "大神官", ro: "Daishinkan", race: "Angel", gender: "Male", planet: 24 },
	{ id: 82, ja: "ナッパ", ro: "Nappa", race: "Saiyan", gender: "Male", planet: 3 },
	{ id: 90, ja: "純粋の魔人ブウ", ro: "Junsui no Majin Bū", race: "Majin", gender: "Male", planet: null },
	{ id: 326, ja: "餃子", ro: "Chaozu", race: "Human", gender: "Male", planet: 2 },
	{ id: 684, ja: "カリン", ro: "Karin", race: "Senbyō (Chat Divin)", gender: "Male", planet: 2 },
	{ id: 853, ja: "ミスター・ポポ", ro: "Misutā Popo", race: "Génie Divin", gender: "Male", planet: 2 },
	{ id: 926, ja: "ウーロン", ro: "Ūron", race: "Animal anthropomorphe", gender: "Male", planet: 2 },
	{ id: 945, ja: "パラガス", ro: "Paragasu", race: "Saiyan", gender: "Male", planet: 3 },
	{ id: 1018, ja: "ベジータ王", ro: "Bejīta-ō", race: "Saiyan", gender: "Male", planet: 3 },
	{ id: 68, ja: "ブロリー", ro: "Burorī", race: "Saiyan", gender: "Male", planet: 3 },
	{ id: 38, ja: "ジレン", ro: "Jiren", race: "Alien (Univers 11)", gender: "Male", planet: 25 },
	{ id: 39, ja: "トッポ", ro: "Toppo", race: "Alien (Univers 11)", gender: "Male", planet: 25 },
	{ id: 40, ja: "ディスポ", ro: "Disupo", race: "Alien (Univers 11)", gender: "Male", planet: 25 },
];

console.log(`Enrichissement de ${CHAR_UPDATES.length} personnages majeurs...`);

for (const c of CHAR_UPDATES) {
	await sql`
		UPDATE bot.db_characters SET
			name_ja = COALESCE(${c.ja}, name_ja),
			name_romaji = COALESCE(${c.ro}, name_romaji),
			race = COALESCE(${c.race}, race),
			gender = COALESCE(${c.gender}, gender),
			origin_planet_id = COALESCE(${c.planet}, origin_planet_id)
		WHERE id = ${c.id};
	`;
	console.log(`  ✓ Personnage enrichi : ID ${c.id} (${c.ja})`);
}

console.log("Terminé avec succès.");
await sql.end();
