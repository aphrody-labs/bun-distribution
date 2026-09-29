import type { GuildMember } from "discord.js";
import { RACE_IDS, RACES, isRaceId, type RaceId } from "~/lib/races";
import type { DB } from "~/db/index";
import { raceLevelRoles } from "~/db/schema";

/**
 * Échelle de transformations (rôles de palier) PAR RACE.
 *
 * Chaque race possède sa propre suite de rôles « transformation » attribués au fil
 * des paliers de niveau (1..10, cf. LEVEL_THRESHOLDS). Quand un membre change de
 * race, on RETIRE les rôles de palier des autres races et on (re)pose ceux de sa
 * race actuelle jusqu'à son niveau (cf. LevelService.syncRaceLevelRoles).
 *
 * `RACE_LEVEL_ROLES` = échelle par DÉFAUT (seed) + repli quand le cache DB n'est
 * pas encore hydraté (scripts standalone, tests). La SOURCE DE VÉRITÉ runtime est
 * la table `race_level_roles` (éditable via le dashboard admin), chargée dans le
 * cache module par `loadRaceLevelRoles(db)` au boot puis relue par `reloadRaceLevelRoles()`.
 *
 * Saiyan = échelle canonique historique (Kaioken → Perfect Ultra Instinct), reprise
 * de data/guild-scan.json — c'est la seule source de vérité des roleId Saiyan par
 * défaut (le seed level_rewards la réutilise). Les AUTRES races sont vides par défaut
 * → tant qu'une race n'a pas de paliers configurés, ses membres n'ont pas de rôle de
 * transformation et le sync NE retire PAS leurs rôles existants (cf. hasRaceLadder).
 *
 * bun:sqlite est SYNCHRONE → l'API publique de ce module reste synchrone (pas d'async).
 */
export const RACE_LEVEL_ROLES: Record<RaceId, Partial<Record<number, string>>> = {
	saiyan: {
		1: "1058910891124457482", // Kaioken
		2: "1058910426164908075", // Super Saiyan
		3: "1058910477847109743", // Super Saiyan 2
		4: "1058910518720593920", // Super Saiyan 3
		5: "1058910672068563024", // Super Saiyan 4
		6: "1058910743736614962", // Super Saiyan God
		7: "1058910776687087637", // Super Saiyan Blue
		8: "1074616048487247902", // Super Saiyan Blue Évolution
		9: "1074616052350193674", // Ultra Instinct
		10: "1074619485450932304", // Perfect Ultra Instinct
	},
	// Vides par défaut — complétées par l'admin via le dashboard (table race_level_roles) :
	humain: {},
	namek: {},
	mutant: {},
	cyborg: {},
	majin: {},
};

/** Race de repli pour l'attribution des paliers quand aucun rôle de race n'est posé. */
export const DEFAULT_LEVEL_RACE: RaceId = "saiyan";

const ROLE_TO_RACE = new Map<string, RaceId>(RACE_IDS.map((id) => [RACES[id].roleId, id]));

type RaceLadders = Record<RaceId, Partial<Record<number, string>>>;

/**
 * Cache runtime des échelles par race (source = table `race_level_roles`).
 * `null` tant que `loadRaceLevelRoles` n'a pas tourné → on retombe sur
 * `RACE_LEVEL_ROLES` (défaut), ce qui garde les scripts standalone + tests purs.
 */
let cache: RaceLadders | null = null;
let dbRef: DB | null = null;

/** Échelles effectives : cache DB si hydraté, sinon défaut. */
function ladders(): RaceLadders {
	return cache ?? RACE_LEVEL_ROLES;
}

function emptyLadders(): RaceLadders {
	return { saiyan: {}, humain: {}, namek: {}, mutant: {}, cyborg: {}, majin: {} };
}

/** (Re)lit la table `race_level_roles` dans le cache module. */
function rebuildCache(): void {
	if (!dbRef) return;
	const rows = dbRef.select().from(raceLevelRoles).all();
	const next = emptyLadders();
	for (const row of rows) {
		if (isRaceId(row.race)) next[row.race][row.level] = row.roleId;
	}
	cache = next;
}

/**
 * Hydrate le cache des rôles de palier depuis la DB. À appeler AU BOOT, APRÈS les
 * migrations et AVANT tout level-up / sync de rôles. Si la table est vide, elle est
 * seedée depuis `RACE_LEVEL_ROLES` (échelle Saiyan) puis relue dans le cache.
 * Synchrone (bun:sqlite).
 */
export function loadRaceLevelRoles(db: DB): void {
	dbRef = db;
	const existing = db.select().from(raceLevelRoles).all();
	if (existing.length === 0) {
		const seed: { race: string; level: number; roleId: string }[] = [];
		for (const race of RACE_IDS) {
			for (const [lvl, roleId] of Object.entries(RACE_LEVEL_ROLES[race])) {
				if (roleId) seed.push({ race, level: Number(lvl), roleId });
			}
		}
		if (seed.length) db.insert(raceLevelRoles).values(seed).run();
	}
	rebuildCache();
}

/** Re-lit la table `race_level_roles` dans le cache (appelé par l'API après une écriture). */
export function reloadRaceLevelRoles(): void {
	rebuildCache();
}

/** true ssi la race possède au moins un palier de rôle configuré. */
export function hasRaceLadder(race: RaceId): boolean {
	return Object.values(ladders()[race]).some((r) => !!r);
}

/** Tous les rôles de transformation configurés, toutes races confondues (pour le nettoyage). */
export function allRaceLevelRoleIds(): string[] {
	const l = ladders();
	return RACE_IDS.flatMap((id) => Object.values(l[id]).filter((r): r is string => !!r));
}

/** Rôles de palier d'une race jusqu'au niveau `uptoLevel` inclus. */
export function raceLevelRoleIds(race: RaceId, uptoLevel: number): string[] {
	const map = ladders()[race];
	const out: string[] = [];
	for (let lvl = 1; lvl <= uptoLevel; lvl++) {
		const r = map[lvl];
		if (r) out.push(r);
	}
	return out;
}

/** Rôle de palier attribué exactement au niveau `level` d'une race (ou null). */
export function raceLevelRoleAt(race: RaceId, level: number): string | null {
	return ladders()[race][level] ?? null;
}

/** Niveau associé à un rôle de palier (toutes races) ou null. */
export function levelOfRoleId(roleId: string): number | null {
	const l = ladders();
	for (const id of RACE_IDS) {
		for (const [lvl, rid] of Object.entries(l[id])) {
			if (rid === roleId) return Number(lvl);
		}
	}
	return null;
}

/** Race effective d'un membre = la race dont il porte le rôle Discord, sinon null. */
export function memberRaceId(member: GuildMember): RaceId | null {
	for (const [roleId, race] of ROLE_TO_RACE) {
		if (member.roles.cache.has(roleId)) return race;
	}
	return null;
}
