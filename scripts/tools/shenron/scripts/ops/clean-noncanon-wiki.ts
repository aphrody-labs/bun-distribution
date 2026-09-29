#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * @file scripts/ops/clean-noncanon-wiki.ts
 *
 * Décontamination canonique du wiki Shenron :
 * Masquage logique (visible = false) de toutes les techniques, personnages et
 * transformations issus exclusivement de jeux vidéo (Xenoverse 2, DBO, SDBH),
 * fan-arts, fakes ou memes internet et non attestés dans le canon
 * (manga 42 tomes d'Akira Toriyama, Dragon Ball Super, Daizenshuu 7, Chōzenshū 4, SEG).
 *
 * Conforme à la règle impérative #9 : suppression logique uniquement (visible = false),
 * aucun DELETE physique en base.
 *
 * Usage :
 *   bun scripts/ops/clean-noncanon-wiki.ts            # Simulation (dry-run)
 *   bun scripts/ops/clean-noncanon-wiki.ts --apply    # Application en base + sync
 */

import postgres from "postgres";
import { urlBase } from "../../apps/site/scripts/_databooks-base";
import { TECHNIQUES as LEXICON_TECHNIQUES } from "../../apps/site/scripts/_technique-lexicon";

const APPLY = process.argv.includes("--apply");

/**
 * Identifiants des techniques strictement canoniques à conserver (visible = true).
 * Sources vérifiées : 42 tomes du manga original, DBS manga, dictionnaires de techniques
 * officiels (Daizenshuu 7, Chōzenshū 4, SEG).
 */
const CANON_TECHNIQUE_IDS = new Set<number>([
	// Corpus de preuves du lexique canonique (_technique-lexicon.ts)
	...LEXICON_TECHNIQUES.map((t) => t.id),
	// Capacités et attaques fondamentales du manga / DBS / databooks officiels
	2,   // Flight (舞空術 - Bukūjutsu)
	3,   // Ki Sense (気の感知)
	19,  // Kiai (気合い)
	25,  // Magic Materialization (物質出現魔術)
	33,  // Ki Blast (気功弾 - Kikōdan)
	36,  // Telekinesis (念力)
	56,  // Power Ball (パワーボール - Lune artificielle Vegeta)
	109, // Double Sunday (ダブルサンデー - Raditz)
	114, // Kamehameha (かめはめ波)
	115, // Super Kamehameha (超かめはめ波)
	128, // Genkidama (元気玉)
	129, // Téléportation (瞬間移動 - Shunkan Idō)
	136, // Kamehameha x10 (10倍かめはめ波)
	138, // Chifumi (ジャン拳 - Goku)
	144, // Kamekameha (かめかめ波 - Goten)
	147, // Masenko (魔閃光 - Gohan)
	159, // Kienzan (気円斬 - Krilin)
	160, // Kaioken (界王拳 - Goku)
	161, // Kaioken x3 (3倍界王拳)
	162, // Kaioken x20 (20倍界王拳)
	166, // Technique du loup (狼牙風風拳 - Yamcha)
	171, // Image rémanente (残像拳 - Zanzōken)
	173, // Dodompa (どどん波 - Tao Pai Pai)
	174, // Kikoho (気功砲 - Tenshinhan)
	175, // Attaque volley-ball (排球拳 - Tenshinhan)
	176, // Morsure du soleil (太陽拳 - Tenshinhan)
	188, // Canon Garric (ギャリック砲 - Vegeta)
	201, // Recoom Eraser Gun (リクームイレイザーガン - Recoome)
	202, // Recoom Kick (リクームキック - Recoome)
	215, // Rayon mortel (デスビーム - Freeza)
	220, // Attaque brûlante (バーニングアタック - Trunks)
	259, // Barrage DIE DIE (Gotenks)
	262, // Big bang (ビッグバンアタック - Vegeta)
	286, // Big Bang Kamehameha (ビッグバンかめはめ波 - Gogeta)
	288, // Dynamite Kick (ダイナマイトキック - Mr. Satan / Gotenks)
	327, // Attaque Kaioken (界王拳アタック - Goku)
	328, // Kaioken Kamehameha (界王拳かめはめ波 - Goku vs Vegeta)
	337, // Néo-technique du loup (新狼牙風風拳 - Yamcha)
	346, // Super beignets galactiques (Gotenks)
	352, // Rocket punch (C-16)
	421, // Rayon bonbon (Majin Buu)
	454, // Final flash (ファイナルフラッシュ - Vegeta)
	467, // Kamehameha divin (神越かめはめ波 - Goku DBS)
	494, // Makankosappo (魔貫光殺砲 - Piccolo)
	558, // Super Genkidama (超元気玉 - Goku vs Boo)
	562, // Kamehameha père-fils (親子かめはめ波 - Gohan vs Cell)
	564, // Grenade infernale (魔空包囲弾 - Piccolo vs C-17)
	565, // Barrage de Kienzan enchaîné (気円連斬 - Krilin)
	567, // Sokidan (操気弾 - Yamcha)
	568, // Shin kikoho (新気功砲 - Tenshinhan vs Cell)
	580, // Échange des corps (ボディチェンジ - Ginyu)
	581, // Supernova (スーパーノヴァ - Freeza)
	582, // Boule de la Mort (デスボール - Freeza)
	588, // Double Kienzan (連気円斬 - Krilin)
	589, // Kamehameha parfait (パーフェクトかめはめ波 - Cell)
	596, // Super fantômes kamikazes (スーパーゴーストカミカゼアタック - Gotenks)
	597, // Épée spirituelle (Vegetto)
	605, // Big bang Kamehameha x100 (100倍ビッグバンかめはめ波 - Gogeta SS4)
	614, // Champ d'énergie (C-17)
	617, // Kamehameha téléporté (瞬間移動かめはめ波 - Goku vs Cell)
	618, // Super canon Garric (超ギャリック砲 - Vegeta)
	620, // Poing du dragon (龍拳 - Film 13 / DBGT)
	621, // Kaioken Kamehameha x4 (4倍界王拳かめはめ波 - Goku vs Vegeta)
	622, // Kaioken Kamehameha x20 (20倍界王拳かめはめ波 - Goku vs Freeza)
	626, // Explosion finale (ファイナルエクスプロージョン - Majin Vegeta)
	632, // Kamehameha final (ファイナルかめはめ波 - Vegetto)
	635, // Flammes de l'enfer (C-16)
	637, // Kamehameha à une main v2 (片手かめはめ波・改 - Mirai Gohan)
	639, // Kamehameha à une main (片手かめはめ波 - Mirai Gohan)
	642, // Châtiment spirituel (Stardust Breaker - Gogeta)
	649, // Super Kamehameha Black (ブラックかめはめ波 - Goku Black)
	658, // Super Kamehameha Black Rosé (超ブラックかめはめ波・ロゼ - Goku Black)
	660, // Épée de l'espoir (Trunks DBS)
	746, // Makankosappo (Beast) (魔貫光殺砲（ビースト） - Gohan Beast)
	771, // Super Saiyen Blue Kaioken (SSGSS界王拳 - Goku DBS)
	772, // Kaioken x10 Super Saiyen Blue (10倍SSGSS界王拳 - Goku DBS)
	780, // Ultra Instinct (身勝手の極意 - Goku DBS)
	831, // Mafūba (Vague d'emprisonnement du démon - 魔封波)
]);

/**
 * Personnages inventés exclusivement pour Xenoverse / Dragon Ball Online / SDBH
 * et absents du canon d'Akira Toriyama.
 */
const NON_CANON_CHARACTER_IDS = new Set<number>([
	// Personnages originaux Xenoverse / DBO
	95,   // Dieu démon Demigra (Boss final Xenoverse 1)
	96,   // Kaïo Shin du temps / Chronoa (Xenoverse)
	97,   // Nabana (PNJ soldat Xenoverse 2)
	99,   // Mira (Dragon Ball Online / Xenoverse)
	100,  // Towa (Dragon Ball Online / Xenoverse)
	119,  // Fu (Dragon Ball Xenoverse 2)
	297,  // C-16 (futur) (What-if Xenoverse 2)
	338,  // Cell-X (Dragon Ball Online boss)
	339,  // Cells-X Jr. (Dragon Ball Online)
	355,  // Chronoa (Kaïo Shin du temps)
	410,  // Copymen (Reskin Saibaiman Xenoverse)
	411,  // Cumber (Super Dragon Ball Heroes)
	449,  // Démigra (Antagoniste Xenoverse 1)
	495,  // Fû (Xenoverse 2 / SDBH)
	573,  // Guerrier du futur (Xenoverse 1) (Avatar joueur XV1)
	575,  // Guerrier du futur (Xenoverse 2) (Avatar joueur XV2)
	581,  // Guêpe (Dragon Ball Online)
	590,  // Hearts (Super Dragon Ball Heroes)
	629,  // Hérissons (Dragon Ball Online)
	656,  // Jeunes Tricératops (Dragon Ball Online)
	728,  // Kiwi (Xeno)
	918,  // N°9 (Dragon Ball Online)
	936,  // Oren (SDBH)
	990,  // Pieuvres (Dragon Ball Online)
	1158, // Son Goku (SDBH)
	1178, // Super Oren (SDBH)
	1195, // Tennenmen (Reskin Saibaiman Xenoverse)
	1200, // Tao Pai Pai X (Dragon Ball Online)
	1232, // Tricératops (Dragon Ball Online)
	1275, // Vegeta (SDBH)

	// Variantes What-If (Xeno) issues de jeux vidéo
	216,  // Bardack (Xeno)
	264,  // Broly (Xeno)
	345,  // Cell (Xeno)
	362,  // Chi Shinron (Xeno)
	417,  // Cooler (Xeno)
	458,  // Dâbra (Xeno)
	482,  // Freezer (Xeno)
	535,  // Ginyû (Xeno)
	544,  // Gotenks (Xeno)
	552,  // Gohanks (Xeno)
	553,  // Gogeta (Xeno)
	649,  // Janenba (Xeno)
	791,  // Majin Boo (Xeno)
	938,  // Pan (Xeno)
	954,  // Paragus (Xeno)
	1044, // Roi Vegeta (Xeno)
	1048, // Ryan Shinron (Xeno)
	1049, // Ryû Shinron (Xeno)
	1077, // San Shinron (Xeno)
	1125, // Slugg (Xeno)
	1149, // Son Goku (Xeno)
	1150, // Son Gohan (Xeno)
	1151, // Son Goten (Xeno)
	1175, // Sû Shinron (Xeno)
	1176, // Super Ī Shinron (Xeno)
	1247, // Trunks (Xeno)
	1250, // Tullece (Xeno)
	1264, // Vegeks (Xeno)
	1267, // Vegeta (Xeno)
	1268, // Vegetto (Xeno)
	1337, // Ī Shinron (Xeno)
	1338, // Û Shinron (Xeno)
]);

/**
 * Transformations inventées exclusivement pour des jeux vidéo (SDBH, Xenoverse, DBO),
 * fan-arts / leaks fakes ou memes internet, absentes du canon d'Akira Toriyama.
 */
const NON_CANON_TRANSFORMATION_IDS = new Set<number>([
	17, // 5ème forme (Cooler - film Toei 5, stub)
	20, // FORME DE L'ARBRE UNIVERSEL (SDBH arcade game)
	21, // Super Saiyan rosé 3 (SDBH arcade game)
	22, // Super Saiyan 4 (DAIMA) (Fake leak / fan hoax)
	23, // Transformation par métamorphose (Janemba - film Toei 12, stub)
	25, // NAMEK AU YEUX ROUGE (Dragon Ball Online / Xenoverse)
	28, // Forme de Saiyan Maléfique (Cumber - SDBH)
	30, // Super Saiyan WHATSAPP (Meme)
	32, // FORME ULTRA SUPER VILLAIN (Xenoverse 2)
	33, // WATER VEGETA (Meme)
]);

console.log("🐉 \x1b[1;36mShenron — Décontamination Canonique du Wiki\x1b[0m");
if (!APPLY) console.log("🔍 \x1b[33mMode SIMULATION (--dry-run) : aucune modification en base.\x1b[0m\n");

const dbUrl = await urlBase();
const sql = postgres(dbUrl, { max: 2, prepare: false });

try {
	// ── 1. TECHNIQUES ──────────────────────────────────────────────────────────
	console.log("=== 1. Audit et nettoyage des techniques (bot.db_techniques) ===");
	const allTechs = await sql<{ id: number; name: string; type: string | null; visible: boolean }[]>`
		SELECT id, name, type, visible FROM bot.db_techniques ORDER BY id
	`;

	const techsToHide = allTechs.filter((t) => !CANON_TECHNIQUE_IDS.has(Number(t.id)) && t.visible);
	const techsToKeep = allTechs.filter((t) => CANON_TECHNIQUE_IDS.has(Number(t.id)));

	console.log(`  · Total techniques en base        : ${allTechs.length}`);
	console.log(`  · Techniques canoniques préservées : \x1b[1;32m${techsToKeep.length}\x1b[0m`);
	console.log(`  · Techniques non-canon à masquer   : \x1b[1;31m${techsToHide.length}\x1b[0m`);

	if (APPLY && techsToHide.length > 0) {
		const ids = techsToHide.map((t) => Number(t.id));
		await sql`UPDATE bot.db_techniques SET visible = false WHERE id IN ${sql(ids)}`;
		console.log(`  ✓ ${ids.length} techniques masquées avec succès (visible = false).`);
	} else if (!APPLY) {
		console.log("  [dry-run] Exemple de techniques qui seront masquées :");
		for (const t of techsToHide.slice(0, 10)) {
			console.log(`     - #${t.id} ${t.name} (${t.type ?? "non classée"})`);
		}
	}

	// ── 2. PERSONNAGES ─────────────────────────────────────────────────────────
	console.log("\n=== 2. Audit et nettoyage des personnages (bot.db_characters) ===");
	const allChars = await sql<{ id: number; name: string; visible: boolean }[]>`
		SELECT id, name, visible FROM bot.db_characters WHERE id IN ${sql([...NON_CANON_CHARACTER_IDS])} ORDER BY id
	`;

	const charsToHide = allChars.filter((c) => c.visible);
	console.log(`  · Personnages Xenoverse/DBO ciblés : ${allChars.length}`);
	console.log(`  · Personnages non-canon à masquer  : \x1b[1;31m${charsToHide.length}\x1b[0m`);

	if (APPLY && charsToHide.length > 0) {
		const ids = charsToHide.map((c) => Number(c.id));
		await sql`UPDATE bot.db_characters SET visible = false WHERE id IN ${sql(ids)}`;
		console.log(`  ✓ ${ids.length} personnages masqués avec succès (visible = false).`);
	} else if (!APPLY) {
		console.log("  [dry-run] Personnages qui seront masqués :");
		for (const c of charsToHide) {
			console.log(`     - #${c.id} ${c.name}`);
		}
	}

	// ── 3. TRANSFORMATIONS ─────────────────────────────────────────────────────
	console.log("\n=== 3. Audit et nettoyage des transformations (bot.db_transformations) ===");
	const allTransfos = await sql<{ id: number; name: string; visible: boolean }[]>`
		SELECT id, name, visible FROM bot.db_transformations ORDER BY id
	`;

	const transfosToHide = allTransfos.filter((t) => NON_CANON_TRANSFORMATION_IDS.has(Number(t.id)) && t.visible);
	const transfosToKeep = allTransfos.filter((t) => !NON_CANON_TRANSFORMATION_IDS.has(Number(t.id)) && t.visible);

	console.log(`  · Total transformations en base       : ${allTransfos.length}`);
	console.log(`  · Transformations canoniques gardées : \x1b[1;32m${transfosToKeep.length}\x1b[0m`);
	console.log(`  · Transformations non-canon à masquer : \x1b[1;31m${transfosToHide.length}\x1b[0m`);

	if (APPLY && transfosToHide.length > 0) {
		const ids = transfosToHide.map((t) => Number(t.id));
		await sql`UPDATE bot.db_transformations SET visible = false WHERE id IN ${sql(ids)}`;
		console.log(`  ✓ ${ids.length} transformations masquées avec succès (visible = false).`);
	} else if (!APPLY) {
		console.log("  [dry-run] Transformations qui seront masquées :");
		for (const t of transfosToHide) {
			console.log(`     - #${t.id} ${t.name}`);
		}
	}

	// ── 4. SYNCHRONISATION REPLICA BOT (SQLITE) ───────────────────────────────
	if (APPLY) {
		console.log("\n=== 4. Synchronisation du réplica SQLite bot ===");
		const syncProc = Bun.spawn(["bun", "apps/bot/scripts/sync-neon-to-sqlite.ts"], {
			stdout: "inherit",
			stderr: "inherit",
			env: { ...process.env, DATABASE_URL: dbUrl },
		});
		const syncCode = await syncProc.exited;
		if (syncCode === 0) {
			console.log("  ✓ Réplica SQLite synchronisé avec succès.");
		} else {
			console.warn(`  ⚠ La synchronisation SQLite a retourné le code ${syncCode}.`);
		}
	}

	console.log("\n✨ \x1b[1;32mOpération terminée avec succès.\x1b[0m");
} finally {
	await sql.end();
}
