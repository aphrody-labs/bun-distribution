// SPDX-License-Identifier: Apache-2.0
/**
 * Système de races (inspiré Dragon Ball Xenoverse 2).
 *
 * Un membre choisit UNE race (rôle Discord exclusif) qui module sa progression.
 * Les traits transposent les traits FACTUELS des races CaC de Xenoverse 2
 * (cf. docs/races-systeme-niveau.md) sur les leviers du bot (XP, vocal, zéni, jeux).
 *
 * Les 6 races correspondent aux rôles du serveur : Saiyan, Humain, Namek, Mutant,
 * Cyborg, Majin. Module PUR (aucune dépendance DB/Discord) → testable.
 */
export const RACE_IDS = ["saiyan", "humain", "namek", "mutant", "cyborg", "majin"] as const;
export type RaceId = (typeof RACE_IDS)[number];

export interface RaceDef {
	id: RaceId;
	name: string;
	emoji: string;
	color: number; // couleur d'embed
	roleId: string; // rôle Discord exclusif sur le serveur
	trait: string; // saveur / inspiration XV2
	perk: string; // effet concret côté bot
	xpMessage: number; // multiplicateur XP par message
	xpVoice: number; // multiplicateur XP vocal
	zeni: number; // multiplicateur des gains de zéni (général)
	gameZeni: number; // multiplicateur supplémentaire des gains de jeux
	zenkai: boolean; // boost temporaire d'XP après un palier
	regen: boolean; // régén passive quotidienne (XP + zéni)
}

// Zenkai (Saiyan) : boost d'XP après une montée de niveau.
export const ZENKAI_MULT = 1.5;
export const ZENKAI_MS = 60 * 60_000; // 1 h

// Régén passive (Namek) : 1×/24 h, à la première activité.
export const REGEN_MS = 24 * 60 * 60_000;
export const REGEN_XP = 200;
export const REGEN_ZENI = 200;

export const RACES: Record<RaceId, RaceDef> = {
	saiyan: {
		id: "saiyan",
		name: "Saiyan",
		emoji: "⚡",
		color: 0xf5c518,
		roleId: "935209502104510564",
		trait: "Guerrier né : monte vite et se surpasse après chaque combat (Zenkai).",
		perk: "×1,25 XP (chat + vocal) + « Zenkai » : +50 % XP pendant 1 h après chaque palier.",
		xpMessage: 1.25,
		xpVoice: 1.25,
		zeni: 1,
		gameZeni: 1,
		zenkai: true,
		regen: false,
	},
	humain: {
		id: "humain",
		name: "Humain",
		emoji: "🌍",
		color: 0x4aa3df,
		roleId: "1516949508049731584",
		trait: "Équilibré et débrouillard : objets plus efficaces, économe.",
		perk: "+25 % de zéni sur tous les gains (drops, daily, jeux, paliers).",
		xpMessage: 1,
		xpVoice: 1,
		zeni: 1.25,
		gameZeni: 1,
		zenkai: false,
		regen: false,
	},
	mutant: {
		id: "mutant",
		name: "Mutant",
		emoji: "🧬",
		color: 0x9b1c8f,
		roleId: "1516949507265400932",
		trait: "Puissance brute et instable : frappe fort en continu, sans répit.",
		perk: "×1,4 XP en chat (puissance brute, montée régulière à l'écrit).",
		xpMessage: 1.4,
		xpVoice: 1,
		zeni: 1,
		gameZeni: 1,
		zenkai: false,
		regen: false,
	},
	namek: {
		id: "namek",
		name: "Namek",
		emoji: "🟢",
		color: 0x2ecc71,
		roleId: "1516949508687397015",
		trait: "Grande santé, régénération, patience.",
		perk: "×1,1 XP + régén passive quotidienne (+200 XP & +200 Ƶ à la 1re activité du jour).",
		xpMessage: 1.1,
		xpVoice: 1.1,
		zeni: 1,
		gameZeni: 1,
		zenkai: false,
		regen: true,
	},
	cyborg: {
		id: "cyborg",
		name: "Cyborg",
		emoji: "🤖",
		color: 0x9b59b6,
		roleId: "1516949479864008744",
		trait: "Machine infatigable et efficace : présence constante, jamais à court d'énergie.",
		perk: "×1,4 XP en vocal (récompense la présence vocale).",
		xpMessage: 1,
		xpVoice: 1.4,
		zeni: 1,
		gameZeni: 1,
		zenkai: false,
		regen: false,
	},
	majin: {
		id: "majin",
		name: "Majin",
		emoji: "👹",
		color: 0xff69b4,
		roleId: "1516949624294739968",
		trait: "Imprévisible et joueur, stats variables.",
		perk: "+50 % de zéni sur les gains aux mini-jeux (joueur né).",
		xpMessage: 1,
		xpVoice: 1,
		zeni: 1,
		gameZeni: 1.5,
		zenkai: false,
		regen: false,
	},
};

/** Tous les rôles de race (pour retirer les autres lors d'un choix). */
export const RACE_ROLE_IDS = RACE_IDS.map((id) => RACES[id].roleId);

export function isRaceId(s: string | null | undefined): s is RaceId {
	return !!s && (RACE_IDS as readonly string[]).includes(s);
}

export function getRace(id: string | null | undefined): RaceDef | null {
	return isRaceId(id) ? RACES[id] : null;
}

/** Multiplicateur d'XP par message, Zenkai inclus si la fenêtre est active. */
export function messageXpMultiplier(
	race: string | null | undefined,
	boostUntil?: number | null,
	now?: number
): number {
	const def = getRace(race);
	if (!def) return 1;
	const zenkai = def.zenkai && boostUntil && typeof now === "number" && boostUntil > now ? ZENKAI_MULT : 1;
	return def.xpMessage * zenkai;
}

/** Multiplicateur d'XP vocal, Zenkai inclus si la fenêtre est active. */
export function voiceXpMultiplier(
	race: string | null | undefined,
	boostUntil?: number | null,
	now?: number
): number {
	const def = getRace(race);
	if (!def) return 1;
	const zenkai = def.zenkai && boostUntil && typeof now === "number" && boostUntil > now ? ZENKAI_MULT : 1;
	return def.xpVoice * zenkai;
}

/**
 * Surcharges admin (clés `race.*` de `guild_settings`) : zénis par race et
 * régén Namek. Posées par `SettingsService` à chaque rechargement, comme la
 * courbe de niveaux, pour que les fonctions ci-dessous restent synchrones.
 */
let zeniTuning: Partial<Record<RaceId, { zeni?: number; gameZeni?: number }>> = {};
let regen = { xp: REGEN_XP, zeni: REGEN_ZENI, ms: REGEN_MS };

export function setRaceTuning(values: ReadonlyMap<string, string>): void {
	const num = (key: string) => {
		const raw = values.get(key);
		const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
		return Number.isFinite(n) && n >= 0 ? n : undefined;
	};
	zeniTuning = Object.fromEntries(
		RACE_IDS.map((id) => [id, { zeni: num(`race.${id}.zeni`), gameZeni: num(`race.${id}.game_zeni`) }])
	);
	const hours = num("race.regen.hours");
	regen = {
		xp: Math.trunc(num("race.regen.xp") ?? REGEN_XP),
		zeni: Math.trunc(num("race.regen.zeni") ?? REGEN_ZENI),
		ms: hours === undefined ? REGEN_MS : hours * 60 * 60_000,
	};
}

/** Régén passive en vigueur : XP, zénis et intervalle. */
export function regenTuning(): { xp: number; zeni: number; ms: number } {
	return regen;
}

/** Applique les multiplicateurs de zéni d'une race à un montant (>0). */
export function applyZeniRace(
	race: string | null | undefined,
	amount: number,
	isGame = false
): number {
	const def = getRace(race);
	if (!def || amount <= 0) return amount;
	const tuning = zeniTuning[def.id];
	const mult = (tuning?.zeni ?? def.zeni) * (isGame ? (tuning?.gameZeni ?? def.gameZeni) : 1);
	return Math.floor(amount * mult);
}

export function hasZenkai(race: string | null | undefined): boolean {
	return getRace(race)?.zenkai ?? false;
}

export function hasRegen(race: string | null | undefined): boolean {
	return getRace(race)?.regen ?? false;
}
