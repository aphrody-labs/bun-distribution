#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * translate-jp-fr.ts — Pipeline souverain de traduction Japonais -> Français.
 * Fusionne le moteur Google Translate multi-tier de Bxc et le système de protection
 * terminologique et de contrôle qualité de Shenron (Dragon Ball FR + Inazuma Eleven).
 *
 * Usage:
 *   bun scripts/translate-jp-fr.ts "孫悟空は界王拳を使った"
 *   bun scripts/translate-jp-fr.ts --file ./texte.ja.txt --out ./texte.fr.txt
 *   echo "亜風炉照美の必殺技はヘブンズタイムだ。" | bun scripts/translate-jp-fr.ts -
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── 1. Jetons de protection Shenron ──────────────────────────────────────────
const JETONS = [
	"Zeta", "Yuni", "Kilo", "Nova", "Orga", "Vira", "Puma", "Rexo",
	"Talo", "Miro", "Sano", "Delo", "Faro", "Gemo", "Hino", "Juno",
];

// ── 2. Référentiel canonique (Dragon Ball / Shenron + Inazuma Eleven / Aphrodi) ──
interface TermeCanonique {
	ja: string;
	fr: string;
	kind: string;
}

const CANON_LEXIQUE: TermeCanonique[] = [
	// Dragon Ball (Axe 2 / Shenron)
	{ ja: "孫悟空", fr: "Son Goku", kind: "personnage" },
	{ ja: "悟空", fr: "Goku", kind: "personnage" },
	{ ja: "カカロット", fr: "Kakarotto", kind: "personnage" },
	{ ja: "ベジータ", fr: "Vegeta", kind: "personnage" },
	{ ja: "サイヤ人", fr: "Saiyan", kind: "concept" },
	{ ja: "超サイヤ人", fr: "Super Saiyan", kind: "concept" },
	{ ja: "超サイヤ人ゴッド", fr: "Super Saiyan God", kind: "concept" },
	{ ja: "界王拳", fr: "Kaïō-ken", kind: "technique" },
	{ ja: "かめはめ波", fr: "Kaméhaméha", kind: "technique" },
	{ ja: "元気玉", fr: "Genki Dama", kind: "technique" },
	{ ja: "気円斬", fr: "Kienzan", kind: "technique" },
	{ ja: "魔貫光殺砲", fr: "Makankosappo", kind: "technique" },
	{ ja: "ピッコロ", fr: "Piccolo", kind: "personnage" },
	{ ja: "クリリン", fr: "Krilin", kind: "personnage" },
	{ ja: "ヤムチャ", fr: "Yamcha", kind: "personnage" },
	{ ja: "天津飯", fr: "Tenshinhan", kind: "personnage" },
	{ ja: "餃子", fr: "Chaozu", kind: "personnage" },
	{ ja: "亀仙人", fr: "Tortue Géniale (Kame Sennin)", kind: "personnage" },
	{ ja: "フリーザ", fr: "Freezer", kind: "personnage" },
	{ ja: "セル", fr: "Cell", kind: "personnage" },
	{ ja: "魔人ブウ", fr: "Majin Boo", kind: "personnage" },
	{ ja: "神龍", fr: "Shenron", kind: "personnage" },
	{ ja: "大界王", fr: "Grand Kaïō", kind: "personnage" },
	{ ja: "破壊神ビルス", fr: "Beerus le destructeur", kind: "personnage" },
	{ ja: "ウイス", fr: "Whis", kind: "personnage" },
	{ ja: "ドラゴンボール", fr: "Dragon Ball", kind: "concept" },

	// Inazuma Eleven / Level-5 / Niers (Axe 1 / Aphrodi)
	{ ja: "亜風炉 照美", fr: "Aphrodi (Byron Love)", kind: "personnage" },
	{ ja: "亜風炉照美", fr: "Aphrodi (Byron Love)", kind: "personnage" },
	{ ja: "アフロディ", fr: "Aphrodi", kind: "personnage" },
	{ ja: "世宇子", fr: "Zeus", kind: "lieu" },
	{ ja: "世宇子中", fr: "Collège Zeus", kind: "lieu" },
	{ ja: "雷門", fr: "Raimon", kind: "lieu" },
	{ ja: "雷門中", fr: "Collège Raimon", kind: "lieu" },
	{ ja: "帝国学園", fr: "Royal Academy", kind: "lieu" },
	{ ja: "円堂 守", fr: "Mark Evans (Mamoru Endo)", kind: "personnage" },
	{ ja: "円堂守", fr: "Mark Evans", kind: "personnage" },
	{ ja: "豪炎寺 修也", fr: "Axel Blaze (Shuya Goenji)", kind: "personnage" },
	{ ja: "豪炎寺修也", fr: "Axel Blaze", kind: "personnage" },
	{ ja: "鬼道 有人", fr: "Jude Sharp (Yuto Kido)", kind: "personnage" },
	{ ja: "鬼道有人", fr: "Jude Sharp", kind: "personnage" },
	{ ja: "ゴッドノウズ", fr: "Tir Divin (God Knows)", kind: "technique" },
	{ ja: "ヘブンズタイム", fr: "Temps Céleste (Heaven's Time)", kind: "technique" },
	{ ja: "カオスブレイク", fr: "Tir Chaotique (Chaos Break)", kind: "technique" },
	{ ja: "ゴッドブレイク", fr: "Savoir Divin (God Break)", kind: "technique" },
	{ ja: "ゴッドハンド", fr: "Main Céleste (God Hand)", kind: "technique" },
	{ ja: "マジン・ザ・ハンド", fr: "Main Magique (Majin The Hand)", kind: "technique" },
	{ ja: "ファイアトルネード", fr: "Tornade de Feu (Fire Tornado)", kind: "technique" },
	{ ja: "イナズマイレブン", fr: "Inazuma Eleven", kind: "concept" },
];

// ── 3. Masquage et Restauration ──────────────────────────────────────────────
export function protegerTermes(texte: string, lexique: TermeCanonique[] = CANON_LEXIQUE): { masque: string; table: Map<string, string>; debordement: number } {
	const table = new Map<string, string>();
	let masque = texte;
	let i = 0;
	let debordement = 0;

	// Tri par longueur décroissante pour éviter le masquage de préfixes
	const trie = [...lexique].toSorted((a, b) => b.ja.length - a.ja.length);

	for (const t of trie) {
		if (!t.fr || !masque.includes(t.ja)) continue;
		if (i >= JETONS.length) {
			debordement++;
			continue;
		}
		const jeton = JETONS[i++];
		table.set(jeton, t.fr);
		masque = masque.replaceAll(t.ja, jeton);
	}
	return { masque, table, debordement };
}

export function restaurerTermes(traduction: string, table: Map<string, string>): string {
	let out = traduction;
	const sortedJetons = [...table.keys()].toSorted((a, b) => b.length - a.length);
	for (const jeton of sortedJetons) {
		out = out.replaceAll(jeton, table.get(jeton)!);
	}
	return out;
}

// ── 4. Découpage aux frontières de phrases ──────────────────────────────────
export function segmentsTraduisibles(texte: string, maxSignes = 280): string[] {
	const out: string[] = [];
	let courant = "";
	for (const morceau of texte.split(/(?<=[。！？\n])/)) {
		if (courant.length + morceau.length > maxSignes && courant.trim()) {
			out.push(courant.trim());
			courant = "";
		}
		courant += morceau;
	}
	if (courant.trim()) out.push(courant.trim());
	return out;
}

// ── 5. Détecteurs d'anomalies (intraduisible / refus) ─────────────────────────
const SIMPLIFIES = /[个陆这说见门东车马鸟贝长风飞龙业习乡书买卖画发产]/;
const LATIN_COLLE = /[぀-ヿ一-鿿][a-z]{3,}|(?<![A-Za-z])[a-z]{3,}[぀-ヿ一-鿿]/;

export function intraduisible(texte: string): string | null {
	if (SIMPLIFIES.test(texte)) return "chinois-simplifie";
	if (LATIN_COLLE.test(texte)) return "latin-colle";
	return null;
}

export function proportionJaponais(texte: string): number {
	const nonBlancs = texte.replace(/\s+/g, "");
	if (!nonBlancs) return 0;
	const jaMatches = nonBlancs.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g);
	return (jaMatches ? jaMatches.length : 0) / nonBlancs.length;
}

export function refus(fr: string, _ja: string): string | null {
	const t = fr.trim();
	if (!t) return "traduction-vide";
	const part = proportionJaponais(t);
	if (part > 0.15) {
		return `${Math.round(part * 100)}% de japonais résiduel`;
	}
	return null;
}

// ── 6. Moteur Google Translate (Cascade Bxc -> Google RPC natif) ──────────────
async function fetchGoogleRpc(text: string, source = "ja", target = "fr"): Promise<string> {
	const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
	const res = await fetch(url, {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
			Accept: "application/json",
		},
		signal: AbortSignal.timeout(12000),
	});

	if (!res.ok) throw new Error(`Google RPC HTTP ${res.status}`);
	const data = (await res.json()) as any;
	if (Array.isArray(data) && Array.isArray(data[0])) {
		return data[0].map((c: any) => (typeof c[0] === "string" ? c[0] : "")).join("");
	}
	throw new Error("Format Google RPC inattendu");
}

async function fetchBxcGoogle(text: string, source = "ja", target = "fr"): Promise<string> {
	// Tentative via le binaire bxc ou l'import direct
	try {
		const bxcPath = resolve(process.env.HOME || process.env.USERPROFILE || ".", "bxc/src/google/translate/engine.ts");
		if (existsSync(bxcPath)) {
			const mod = await import(bxcPath);
			const engine = new mod.GoogleTranslateEngine();
			const res = await engine.translate({ q: text, source, target });
			if (res?.data?.translations?.[0]?.translatedText) {
				return res.data.translations[0].translatedText;
			}
		}
	} catch {}

	// Repli sur RPC Google
	return fetchGoogleRpc(text, source, target);
}

// ── 7. Pipeline unifié ───────────────────────────────────────────────────────
export async function traduireJpEnFr(texte: string): Promise<string> {
	const nettoye = texte.trim();
	if (!nettoye) return "";

	const defaut = intraduisible(nettoye);
	if (defaut) {
		console.warn(`[shenron] Alerte : texte japonais suspect (${defaut})`);
	}

	const segments = segmentsTraduisibles(nettoye);
	const segmentsFr: string[] = [];

	for (const seg of segments) {
		const { masque, table } = protegerTermes(seg);
		const traduitMasque = await fetchBxcGoogle(masque, "ja", "fr");
		const restaure = restaurerTermes(traduitMasque, table);

		const anomalie = refus(restaure, seg);
		if (anomalie) {
			console.warn(`[shenron] Contrôle qualité avertissement : ${anomalie}`);
		}
		segmentsFr.push(restaure);
	}

	return segmentsFr.join(" ");
}

// ── 8. CLI Entrypoint ────────────────────────────────────────────────────────
async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		console.log(`Pipeline Aphrody + Bxc Google + Shenron (JP -> FR)
Usage:
  bun scripts/translate-jp-fr.ts "<texte japonais>"
  bun scripts/translate-jp-fr.ts --file <entree> [--out <sortie>]
  echo "<texte>" | bun scripts/translate-jp-fr.ts -
`);
		return;
	}

	let sourceText = "";
	let outPath: string | null = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--file" && args[i + 1]) {
			sourceText = readFileSync(args[i + 1], "utf-8");
			i++;
		} else if (args[i] === "--out" && args[i + 1]) {
			outPath = args[i + 1];
			i++;
		} else if (args[i] === "-") {
			sourceText = await Bun.stdin.text();
		} else if (!args[i].startsWith("-")) {
			sourceText = args[i];
		}
	}

	if (!sourceText.trim()) {
		console.error("Erreur : aucun texte fourni.");
		process.exit(1);
	}

	const resultat = await traduireJpEnFr(sourceText);
	if (outPath) {
		writeFileSync(outPath, resultat, "utf-8");
		console.log(`[ok] Écrit dans ${outPath}`);
	} else {
		console.log(resultat);
	}
}

if (import.meta.main) {
	await main();
}
