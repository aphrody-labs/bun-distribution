import "reflect-metadata";
import "./wiki-write-guard";
import { container } from "tsyringe";
import { botFile } from "~/lib/asset-files";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { dbCharacters, dbPlanets, dbTransformations } from "~/db/schema";
import { WikiService } from "~/services/WikiService";
import { logger } from "~/lib/logger";

const BASE = "https://dragonball-api.com/api";
const LOCAL_IMG_ROOT = "./assets/dbz";

interface RemoteChar {
	id: number;
	name: string;
	ki: string;
	maxKi: string;
	race: string;
	gender: string;
	description: string;
	image: string;
	affiliation: string;
	originPlanet?: { id: number };
	transformations?: Array<{
		id: number;
		name: string;
		ki: string;
		image: string;
	}>;
}

interface RemotePlanet {
	id: number;
	name: string;
	isDestroyed: boolean;
	description: string;
	image: string;
}

function remapImage(
	remoteUrl: string,
	subdir: "characters" | "planetas" | "transformaciones"
): string {
	const m = remoteUrl.match(/\/([^/]+\.(?:webp|png|jpg))(?:\?.*)?$/i);
	if (!m) return remoteUrl;
	const filename = decodeURIComponent(m[1]!);
	const localPath = `${LOCAL_IMG_ROOT}/${subdir}/${filename}`;
	if (existsSync(botFile(localPath))) return localPath;
	return remoteUrl;
}

async function fetchJson<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE}${path}`);
	if (!res.ok) throw new Error(`${path} → ${res.status}`);
	return (await res.json()) as T;
}

async function fetchAll<T>(path: string): Promise<T[]> {
	const first = await fetchJson<{ items: T[]; meta: { totalPages: number } }>(`${path}?limit=100`);
	const all = [...first.items];
	for (let p = 2; p <= first.meta.totalPages; p++) {
		const next = await fetchJson<{ items: T[] }>(`${path}?limit=100&page=${p}`);
		all.push(...next.items);
	}
	return all;
}

export type WikiSeedResult = {
	skipped: boolean;
	planets: number;
	characters: number;
	transformations: number;
	imgMapped: number;
	imgMissing: number;
	enriched: number;
};

/* ─── Enrichissement AniList (noms 日本語 + romaji canon EN) ───────────── */

const ANILIST_URL = "https://graphql.anilist.co";

// Animes Dragon Ball sur AniList (couvre quasi tous les personnages canon)
const ANILIST_DBZ_MEDIA_IDS = [
	223, // Dragon Ball
	813, // Dragon Ball Z
	225, // Dragon Ball GT
	21893, // Dragon Ball Super
];

type AnilistChar = {
	name: { full: string; native: string | null; userPreferred: string };
};

/**
 * Overrides explicites pour les divergences nomenclature dragonball-api (ES)
 * vs AniList (EN/JP canon). Clés = nom dragonball-api normalisé.
 */
const NAME_OVERRIDES: Record<string, { ja: string; romaji: string }> = {
	// Personnages avec divergences nomenclature ES → EN/JP canon
	celula: { ja: "セル", romaji: "Cell" },
	freezer: { ja: "フリーザ", romaji: "Frieza" },
	bills: { ja: "ビルス", romaji: "Beerus" },
	vermoudh: { ja: "ヴァーモッド", romaji: "Vermoud" },
	tenshinhan: { ja: "天津飯", romaji: "Tenshinhan" },
	vegetto: { ja: "ベジット", romaji: "Vegetto" },
	// Goku & famille
	goku: { ja: "孫悟空", romaji: "Son Gokuu" },
	gohan: { ja: "孫悟飯", romaji: "Son Gohan" },
	bardock: { ja: "バーダック", romaji: "Baadakku" },
	// Fusions
	gogeta: { ja: "ゴジータ", romaji: "Gogeta" },
	gotenks: { ja: "ゴテンクス", romaji: "Gotenks" },
	// Cyborgs (AniList = "Jinzouningen XX")
	android13: { ja: "人造人間13号", romaji: "Jinzouningen 13-gou" },
	android14: { ja: "人造人間14号", romaji: "Jinzouningen 14-gou" },
	android15: { ja: "人造人間15号", romaji: "Jinzouningen 15-gou" },
	android16: { ja: "人造人間16号", romaji: "Jinzouningen 16-gou" },
	android17: { ja: "人造人間17号", romaji: "Jinzouningen 17-gou" },
	android18: { ja: "人造人間18号", romaji: "Jinzouningen 18-gou" },
	android19: { ja: "人造人間19号", romaji: "Jinzouningen 19-gou" },
	android20drgero: { ja: "ドクター・ゲロ", romaji: "Dokutaa Gero" },
	// Super: Tournament of Power
	jiren: { ja: "ジレン", romaji: "Jiren" },
	toppo: { ja: "トッポ", romaji: "Toppo" },
	dyspo: { ja: "ディスポ", romaji: "Dyspo" },
	janemba: { ja: "ジャネンバ", romaji: "Janemba" },
	broly: { ja: "ブロリー", romaji: "Broly" },
	zeno: { ja: "全王", romaji: "Zen'ou" },
	marcarita: { ja: "マルカリータ", romaji: "Marcarita" },
	// Kaïos espagnol → canon
	grandpriest: { ja: "大神官", romaji: "Daishinkan" },
	grankaio: { ja: "大界王", romaji: "Daikaiou" },
	grankaioshin: { ja: "大界王神", romaji: "Daikaioushin" },
	kaiodeloeste: { ja: "西の界王", romaji: "Nishi no Kaiou" },
	kaiodelsur: { ja: "南の界王", romaji: "Minami no Kaiou" },
	kaiodeleste: { ja: "東の界王", romaji: "Higashi no Kaiou" },
	kaiodelnortekaito: { ja: "北の界王", romaji: "Kita no Kaiou" },
	kaioshindeleste: { ja: "東の界王神", romaji: "Higashi no Kaioushin" },
	kaioshindelnorte: { ja: "北の界王神", romaji: "Kita no Kaioushin" },
	kaioshindeloeste: { ja: "西の界王神", romaji: "Nishi no Kaioushin" },
	kaioshindelsur: { ja: "南の界王神", romaji: "Minami no Kaioushin" },
	// Autres
	kibito: { ja: "キビト", romaji: "Kibito" },
	kibitoshin: { ja: "キビト神", romaji: "Kibitoshin" },
	launch: { ja: "ランチ", romaji: "Lunch" },
	mrsatan: { ja: "ミスター・サタン", romaji: "Misutaa Satan" },
	nail: { ja: "ネイル", romaji: "Neiru" },
	// Last 6
	krillin: { ja: "クリリン", romaji: "Kuririn" },
	majinbuu: { ja: "魔人ブウ", romaji: "Majin Buu" },
	masterroshi: { ja: "亀仙人", romaji: "Kame-Sennin" },
	raditz: { ja: "ラディッツ", romaji: "Radittsu" },
	whis: { ja: "ウイス", romaji: "Whis" },
	zarbon: { ja: "ザーボン", romaji: "Zaabon" },
};

/**
 * Overrides planètes (l'API ES utilise des noms locaux : Tierra→Earth,
 * Vegeta→Planet Vegeta, etc.). AniList n'a pas de data planètes donc tout hardcodé.
 */
const PLANET_OVERRIDES: Record<string, { ja: string; romaji: string }> = {
	namek: { ja: "ナメック星", romaji: "Namekku-sei" },
	tierra: { ja: "地球", romaji: "Chikyuu" },
	vegeta: { ja: "ベジータ星", romaji: "Bejiita-sei" },
	kanassa: { ja: "カナッサ星", romaji: "Kanassa-sei" },
	freezerno79: { ja: "フリーザ第79惑星", romaji: "Frieza Dai-79 Wakusei" },
	yardrat: { ja: "ヤードラット星", romaji: "Yaadoratto-sei" },
	makyo: { ja: "魔凶星", romaji: "Makyousei" },
	babari: { ja: "バブリ", romaji: "Baburi-sei" },
	monmar: { ja: "モンマール星", romaji: "Monmaaru-sei" },
	otromundo: { ja: "あの世", romaji: "Ano-yo" },
	planetasagrado: { ja: "聖地", romaji: "Seichi" },
	planetadebills: { ja: "ビルスの星", romaji: "Birusu no Hoshi" },
	planetadelgrankaio: { ja: "大界王星", romaji: "Daikaiou-sei" },
	templomovildelreydetodo: { ja: "全王の宮殿", romaji: "Zen'ou no Kyuuden" },
	universo11: { ja: "第11宇宙", romaji: "Dai-11 Uchuu" },
	tsufuruniverso6: { ja: "ツフル星", romaji: "Tsufuru-sei (Uchuu 6)" },
	nuevoplanetatsufrui: { ja: "新ツフル星", romaji: "Shin Tsufuru-sei" },
	nucleodelmundo: { ja: "世界の中心", romaji: "Sekai no Chuushin" },
	kaiodelnorte: { ja: "北の界王星", romaji: "Kita no Kaiou-sei" },
	desconocido: { ja: "不明", romaji: "Fumei" },
};

function normalizeName(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]/g, "");
}

async function fetchAnilistChars(): Promise<Map<string, AnilistChar>> {
	const map = new Map<string, AnilistChar>();
	for (const mediaId of ANILIST_DBZ_MEDIA_IDS) {
		for (let page = 1; page <= 8; page++) {
			const res = await fetch(ANILIST_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					query: `query($id: Int!, $page: Int!) {
						Media(id: $id) {
							characters(page: $page, perPage: 25, sort: ROLE) {
								pageInfo { hasNextPage }
								nodes { name { full native userPreferred } }
							}
						}
					}`,
					variables: { id: mediaId, page },
				}),
			});
			if (!res.ok) break;
			const json = (await res.json()) as {
				data?: {
					Media?: {
						characters?: {
							pageInfo: { hasNextPage: boolean };
							nodes: AnilistChar[];
						};
					};
				};
			};
			const chars = json.data?.Media?.characters;
			if (!chars) break;
			for (const c of chars.nodes) {
				const key = normalizeName(c.name.userPreferred);
				if (!map.has(key)) map.set(key, c);
				// Aussi indexer par `full` au cas où userPreferred = "Son, Gokuu"
				const keyFull = normalizeName(c.name.full);
				if (!map.has(keyFull)) map.set(keyFull, c);
			}
			if (!chars.pageInfo.hasNextPage) break;
			// Respect rate-limit AniList (90/min)
			await new Promise((r) => setTimeout(r, 800));
		}
	}
	return map;
}

async function enrichCharactersWithAnilist(log: (m: string) => void): Promise<number> {
	const dbs = container.resolve(DatabaseService);
	const db = dbs.db;

	log("→ Fetching AniList Dragon Ball characters…");
	const anilistMap = await fetchAnilistChars();
	log(`  ${anilistMap.size} entries indexed (par normalized name)`);

	let updated = 0;

	const existingChars = await db.select().from(dbCharacters);
	for (const c of existingChars) {
		if (c.nameJa && c.nameRomaji) continue;
		const key = normalizeName(c.name);
		const override = NAME_OVERRIDES[key];
		let nameJa: string | null = null;
		let nameRomaji: string | null = null;
		if (override) {
			nameJa = override.ja;
			nameRomaji = override.romaji;
		} else {
			const hit = anilistMap.get(key);
			if (hit) {
				nameJa = hit.name.native;
				nameRomaji = hit.name.userPreferred ?? hit.name.full;
			}
		}
		if (!nameJa && !nameRomaji) continue;
		await db.update(dbCharacters).set({ nameJa, nameRomaji }).where(eq(dbCharacters.id, c.id));
		updated++;
	}
	log(`✓ ${updated}/${existingChars.length} characters enriched JA+romaji`);

	const existingPlanets = await db.select().from(dbPlanets);
	let planetsUpdated = 0;
	for (const p of existingPlanets) {
		if (p.nameJa && p.nameRomaji) continue;
		const key = normalizeName(p.name);
		const override = PLANET_OVERRIDES[key];
		if (!override) continue;
		await db
			.update(dbPlanets)
			.set({ nameJa: override.ja, nameRomaji: override.romaji })
			.where(eq(dbPlanets.id, p.id));
		planetsUpdated++;
	}
	log(`✓ ${planetsUpdated}/${existingPlanets.length} planets enriched JA+romaji`);

	return updated + planetsUpdated;
}

/**
 * Idempotent par défaut : skip si déjà seedé. `force: true` purge + reseed.
 * Réutilisable depuis le bot boot pour self-healing après perte de bot.db.
 */
export async function runWikiSeed(
	opts: { force?: boolean; log?: (msg: string) => void } = {}
): Promise<WikiSeedResult> {
	const log = opts.log ?? ((m: string) => logger.info(m));
	const dbs = container.resolve(DatabaseService);
	const wiki = container.resolve(WikiService);
	const db = dbs.db;

	if (!opts.force && (await wiki.isSeeded())) {
		log("wiki seed: déjà présent, skip dragonball-api fetch");
		const enriched = await enrichCharactersWithAnilist(log).catch((err) => {
			log(`  enrichment AniList échoué (non-fatal): ${err}`);
			return 0;
		});
		const counts = await wiki.count();
		return {
			skipped: true,
			planets: counts.planets,
			characters: counts.characters,
			transformations: counts.transformations,
			imgMapped: 0,
			imgMissing: 0,
			enriched,
		};
	}

	log("→ Fetching planets…");
	const planets = await fetchAll<RemotePlanet>("/planets");
	log(`  ${planets.length} planets`);

	log("→ Fetching characters (list)…");
	const chars = await fetchAll<RemoteChar>("/characters");
	log(`  ${chars.length} characters`);

	if (opts.force) {
		await db.delete(dbTransformations);
		await db.delete(dbCharacters);
		await db.delete(dbPlanets);
	}

	for (const p of planets) {
		await db
			.insert(dbPlanets)
			.values({
				id: p.id,
				name: p.name,
				image: remapImage(p.image, "planetas"),
				isDestroyed: p.isDestroyed,
				description: p.description,
			})
			.onConflictDoNothing();
	}
	log(`✓ ${planets.length} planets inserted`);

	let totalTransfos = 0;
	let imgMapped = 0;
	let imgMissing = 0;

	for (const c of chars) {
		const full = await fetchJson<RemoteChar>(`/characters/${c.id}`);
		const localImg = remapImage(full.image, "characters");
		if (localImg.startsWith(LOCAL_IMG_ROOT)) imgMapped++;
		else imgMissing++;

		await db
			.insert(dbCharacters)
			.values({
				id: full.id,
				name: full.name,
				image: localImg,
				ki: full.ki,
				maxKi: full.maxKi,
				race: full.race,
				gender: full.gender,
				affiliation: full.affiliation,
				description: full.description,
				originPlanetId: full.originPlanet?.id ?? null,
			})
			.onConflictDoNothing();

		for (const t of full.transformations ?? []) {
			const tImg = remapImage(t.image, "transformaciones");
			if (tImg.startsWith(LOCAL_IMG_ROOT)) imgMapped++;
			else imgMissing++;
			await db
				.insert(dbTransformations)
				.values({
					id: t.id,
					name: t.name,
					image: tImg,
					ki: t.ki,
					characterId: full.id,
				})
				.onConflictDoNothing();
			totalTransfos++;
		}
	}

	log(`✓ ${chars.length} characters + ${totalTransfos} transformations inserted`);
	log(`  Images mapped locally: ${imgMapped}, fallback network: ${imgMissing}`);

	const enriched = await enrichCharactersWithAnilist(log).catch((err) => {
		log(`  enrichment AniList échoué (non-fatal): ${err}`);
		return 0;
	});

	// L'enrichissement des descriptions depuis un dump Fandom FR a été retiré :
	// Fandom est une source interdite pour rédiger (cf. CLAUDE.md). Les descriptions
	// viennent désormais des seules sources éditoriales licites (manga, databooks,
	// AniList/Jikan pour les métadonnées).

	return {
		skipped: false,
		planets: planets.length,
		characters: chars.length,
		transformations: totalTransfos,
		imgMapped,
		imgMissing,
		enriched,
	};
}

// CLI standalone : `bun src/db/seed-wiki.ts [--force]`
if (import.meta.main) {
	const force = process.argv.includes("--force");
	runWikiSeed({ force, log: console.log })
		.then(() => {
			const dbs = container.resolve(DatabaseService);
			return dbs.close();
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
