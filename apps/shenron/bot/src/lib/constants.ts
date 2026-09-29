/**
 * Palier XP (en "unités" DragonBall — ex: 10 000 unités, 100 000 unités…)
 * Le level est juste un repère interne ; le message annonce l'XP atteint.
 */
export const LEVEL_THRESHOLDS: readonly { level: number; xp: number }[] = [
	{ level: 1, xp: 1_000 },
	{ level: 2, xp: 5_000 },
	{ level: 3, xp: 10_000 },
	{ level: 4, xp: 25_000 },
	{ level: 5, xp: 50_000 },
	{ level: 6, xp: 100_000 },
	{ level: 7, xp: 250_000 },
	{ level: 8, xp: 500_000 },
	{ level: 9, xp: 1_000_000 },
	{ level: 10, xp: 9_000_000 }, // It's over 9000 !
] as const;

export const XP_PER_MESSAGE_MIN = 15;
export const XP_PER_MESSAGE_MAX = 25;
export const XP_MESSAGE_COOLDOWN_MS = 30_000;

export const XP_PER_VOICE_TICK = 20;
export const XP_VOICE_TICK_MS = 60_000; // tick toutes les 60s

export const ZENI_PER_LEVEL = 1_000;
export const ZENI_DAILY_QUEST = 200;
export const ZENI_GAME_WIN = 100;
export const ZENI_GAME_LOSS_PENALTY = 50;

export const VOCAL_TEMPO_EMPTY_DELAY_MS = 60_000;

/** Bonus fusion: quand un fusionné gagne X, son/sa partenaire gagne floor(X * ratio). */
export const FUSION_XP_BONUS_RATIO = 0.1;
export const FUSION_ZENI_BONUS_RATIO = 0.1;

export const DISCORD_INVITE_REGEX = /discord(?:app)?\.(?:gg|com\/invite)\/[A-Za-z0-9-]+/i;

/**
 * Rôle distribué automatiquement à tout membre (à l'arrivée + backfill au boot).
 * DÉSACTIVÉ : valait le rôle « Saiyan » (935209502104510564), donné à tout le monde
 * — or Saiyan est désormais une RACE choisie (cf. lib/races.ts). Vide = pas d'auto-rôle
 * (le setting `role.auto_join` peut toujours en configurer un, mais assignAutoRole
 * refuse tout rôle de race par sécurité). Voir aussi events/JoinLeave.ts.
 */
export const AUTO_ROLE_ID = "";
