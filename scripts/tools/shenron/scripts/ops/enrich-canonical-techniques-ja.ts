// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/ops/enrich-canonical-techniques-ja.ts
 *
 * Enrichit les variantes canoniques et célèbres des techniques de Dragon Ball
 * dans `bot.db_techniques` avec leurs noms japonais (kanji/kana) et rōmaji Hepburn.
 *
 * Sources : Daizenshuu 7 技事典, Chōzenshū 4, manga original 42 tomes.
 * Respecte strictement la règle non destructive : n'écrase jamais un nom_ja déjà existant.
 */
import postgres from "postgres";

interface TechniqueJaEntry {
	id: number;
	name: string;
	ja: string;
	romaji: string;
}

const TECHNIQUES_CANONIQUES: TechniqueJaEntry[] = [
	{ id: 151, name: "Canon kikoho", ja: "気功砲", romaji: "Kikōhō" },
	{ id: 161, name: "Kaioken x3", ja: "3倍界王拳", romaji: "Sanbai Kaiōken" },
	{ id: 162, name: "Kaioken x20", ja: "20倍界王拳", romaji: "Nijūbai Kaiōken" },
	{ id: 287, name: "Kamehameha feinté", ja: "フェイントかめはめ波", romaji: "Feinto Kamehameha" },
	{ id: 307, name: "Makankosappo Garric", ja: "ギャリック魔貫光殺砲", romaji: "Gyarikku Makankōsappō" },
	{ id: 327, name: "Attaque Kaioken", ja: "界王拳アタック", romaji: "Kaiōken Atakku" },
	{ id: 328, name: "Kaioken Kamehameha", ja: "界王拳かめはめ波", romaji: "Kaiōken Kamehameha" },
	{ id: 336, name: "Super Kienzan", ja: "超気円斬", romaji: "Chō Kienzan" },
	{ id: 387, name: "Double Masenko", ja: "W魔閃光", romaji: "Daburu Masenkō" },
	{ id: 389, name: "Attaque Garric", ja: "ギャリックアタック", romaji: "Gyarikku Atakku" },
	{ id: 441, name: "Final flash vengeur", ja: "リベンジファイナルフラッシュ", romaji: "Ribenji Fainaru Furasshu" },
	{ id: 467, name: "Kamehameha divin", ja: "神越かめはめ波", romaji: "Kamietsu Kamehameha" },
	{ id: 522, name: "Poing Big Bang", ja: "ビッグバンナックル", romaji: "Biggu Ban Nakkuru" },
	{ id: 562, name: "Kamehameha père-fils", ja: "親子かめはめ波", romaji: "Oyako Kamehameha" },
	{ id: 565, name: "Barrage de Kienzan enchaîné", ja: "気円連斬", romaji: "Kien Renzan" },
	{ id: 568, name: "Shin kikoho", ja: "新気功砲", romaji: "Shin Kikōhō" },
	{ id: 588, name: "Double Kienzan", ja: "連気円斬", romaji: "Ren Kienzan" },
	{ id: 589, name: "Kamehameha parfait", ja: "パーフェクトかめはめ波", romaji: "Pāfekuto Kamehameha" },
	{ id: 605, name: "Big bang Kamehameha x100", ja: "100倍ビッグバンかめはめ波", romaji: "Hyakubai Biggu Ban Kamehameha" },
	{ id: 617, name: "Kamehameha téléporté", ja: "瞬間移動かめはめ波", romaji: "Shunkan Idō Kamehameha" },
	{ id: 618, name: "Super canon Garric", ja: "超ギャリック砲", romaji: "Chō Gyarikku Hō" },
	{ id: 621, name: "Kaioken Kamehameha x4", ja: "4倍界王拳かめはめ波", romaji: "Yonbai Kaiōken Kamehameha" },
	{ id: 622, name: "Kaioken Kamehameha x20", ja: "20倍界王拳かめはめ波", romaji: "Nijūbai Kaiōken Kamehameha" },
	{ id: 632, name: "Kamehameha final", ja: "ファイナルかめはめ波", romaji: "Fainaru Kamehameha" },
	{ id: 637, name: "Kamehameha à une main v2", ja: "片手かめはめ波・改", romaji: "Katate Kamehameha Kai" },
	{ id: 639, name: "Kamehameha à une main", ja: "片手かめはめ波", romaji: "Katate Kamehameha" },
	{ id: 649, name: "Super Kamehameha Black", ja: "ブラックかめはめ波", romaji: "Burakku Kamehameha" },
	{ id: 658, name: "Super Kamehameha Black Rosé", ja: "超ブラックかめはめ波・ロゼ", romaji: "Chō Burakku Kamehameha Rozé" },
	{ id: 746, name: "Makankosappo (Beast)", ja: "魔貫光殺砲（ビースト）", romaji: "Makankōsappō (Bīsuto)" },
	{ id: 771, name: "Super Saiyen Blue Kaioken", ja: "SSGSS界王拳", romaji: "Sūpā Saiyajin Burū Kaiōken" },
	{ id: 772, name: "Kaioken x10 Super Saiyen Blue", ja: "10倍SSGSS界王拳", romaji: "Jūbai Sūpā Saiyajin Burū Kaiōken" },
	{ id: 2, name: "Flight", ja: "舞空術", romaji: "Bukūjutsu" },
	{ id: 3, name: "Ki Sense", ja: "気の感知", romaji: "Ki no Kanchi" },
	{ id: 5, name: "Autonomous Ultra Instinct", ja: "身勝手の極意", romaji: "Migatte no Gokui" },
	{ id: 18, name: "Afterimage Technique", ja: "残像拳", romaji: "Zanzōken" },
	{ id: 19, name: "Kiai", ja: "気合い", romaji: "Kiai" },
	{ id: 25, name: "Magic Materialization", ja: "物質出現魔術", romaji: "Busshitsu Shutsugen Majutsu" },
	{ id: 33, name: "Ki Blast", ja: "気功弾", romaji: "Kikōdan" },
	{ id: 36, name: "Telekinesis", ja: "念力", romaji: "Nenriki" },
	{ id: 109, name: "Double Sunday", ja: "ダブルサンデー", romaji: "Daburu Sandē" },
	{ id: 115, name: "Super Kamehameha", ja: "超かめはめ波", romaji: "Chō Kamehameha" },
	{ id: 136, name: "Kamehameha x10", ja: "10倍かめはめ波", romaji: "Jūbai Kamehameha" },
	{ id: 286, name: "Big Bang Kamehameha", ja: "ビッグバンかめはめ波", romaji: "Biggu Ban Kamehameha" },
	{ id: 494, name: "Makankosappo", ja: "魔貫光殺砲", romaji: "Makankōsappō" },
	{ id: 558, name: "Super Genkidama", ja: "超元気玉", romaji: "Chō Genkidama" },
];

async function getDatabaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const envFile = Bun.file("apps/site/.env");
	if (await envFile.exists()) {
		const text = await envFile.text();
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("DATABASE_URL=")) {
				return line.slice(13).trim().replace(/^["']|["']$/g, "");
			}
		}
	}
	throw new Error("DATABASE_URL non configuré");
}

async function main() {
	const dbUrl = await getDatabaseUrl();

	const sql = postgres(dbUrl, { max: 1 });
	console.log("=== Enrichissement Canonique des Techniques JA ===");

	let updated = 0;
	for (const tech of TECHNIQUES_CANONIQUES) {
		const [existing] = await sql<{ id: number; name: string; name_ja: string | null; name_romaji: string | null }[]>`
			SELECT id, name, name_ja, name_romaji FROM bot.db_techniques WHERE id = ${tech.id}
		`;
		if (!existing) {
			console.warn(`[Skip] ID ${tech.id} introuvable en base`);
			continue;
		}

		const jaMissing = !existing.name_ja || existing.name_ja.trim() === "";
		const romajiMissing = !existing.name_romaji || existing.name_romaji.trim() === "";

		if (!jaMissing && !romajiMissing) {
			console.log(`[Skip] #${tech.id} ${existing.name} est déjà complet (${existing.name_ja} / ${existing.name_romaji})`);
			continue;
		}

		await sql`
			UPDATE bot.db_techniques 
			SET name_ja = ${tech.ja}, name_romaji = ${tech.romaji}
			WHERE id = ${tech.id}
		`;
		console.log(`✓ #${tech.id} ${existing.name} → ${tech.ja} (${tech.romaji})`);
		updated++;
	}

	await sql.end();
	console.log(`\nEnrichissement terminé : ${updated} techniques mises à jour avec succès.`);
}

main().catch((err) => {
	console.error("Erreur enrichissement techniques:", err);
	process.exit(1);
});
