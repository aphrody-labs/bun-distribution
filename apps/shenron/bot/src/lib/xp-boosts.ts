/**
 * Multiplicateurs d'XP : rôle ou booster, race et Zenkai, vocal à plusieurs,
 * boost de nuit et sleepcall.
 *
 * La configuration est lue une fois par passage (`loadXpBoostConfig`) puis
 * passée aux calculs, qui restent purs et testables sans base ni Discord.
 * Chaque valeur vit dans `guild_settings` (clés `xp.*`) et s'édite depuis la
 * page admin des niveaux ; les défauts ci-dessous s'appliquent sinon.
 *
 * Ordre d'application d'un gain vocal :
 *   base × min(plafond, rôle × race × Zenkai × groupe × nuit|sleepcall) × statut micro
 * Le statut micro (coupé, casque coupé) réduit le gain après le plafond ; en
 * sleepcall il ne réduit rien, puisqu'on y dort.
 */
import type { Guild } from "discord.js";
import { RACE_IDS, RACES, ZENKAI_MULT, getRace, type RaceId } from "~/lib/races";

export type VoiceStatus = "open" | "muted" | "deafened";

export interface VoicePresence {
	userId: string;
	status: VoiceStatus;
}

export interface XpBoostConfig {
	voice: { minMembers: number; mutedRatio: number; deafenedRatio: number };
	group: { bonusPerMember: number; maxMultiplier: number };
	night: {
		enabled: boolean;
		startHour: number;
		endHour: number;
		timezone: string;
		voiceMultiplier: number;
		messageMultiplier: number;
	};
	sleepcall: {
		enabled: boolean;
		minMembers: number;
		multiplier: number;
		announce: boolean;
		/** Creux toléré avant de clore un sleepcall, la nuit. */
		graceMinutes: number;
		/** Durée minimale pour publier le bilan et journaliser. */
		summaryMinMinutes: number;
	};
	zenkai: { multiplier: number; minutes: number };
	race: Record<RaceId, { message: number; voice: number }>;
	maxMultiplier: number;
}

export const DEFAULT_XP_BOOST_CONFIG: XpBoostConfig = {
	// Seul en vocal, micro coupé : on gagne quand même. Le seuil de 2 membres et
	// le casque coupé à 0 XP (12/09/2026) avaient vidé le vocal de ses gains.
	voice: { minMembers: 1, mutedRatio: 1, deafenedRatio: 0.5 },
	group: { bonusPerMember: 0.1, maxMultiplier: 2 },
	night: {
		enabled: true,
		startHour: 0,
		endHour: 7,
		timezone: "Europe/Paris",
		voiceMultiplier: 1.5,
		messageMultiplier: 1.5,
	},
	sleepcall: {
		enabled: true,
		minMembers: 2,
		multiplier: 2.5,
		announce: true,
		graceMinutes: 5,
		summaryMinMinutes: 15,
	},
	zenkai: { multiplier: ZENKAI_MULT, minutes: 60 },
	race: Object.fromEntries(
		RACE_IDS.map((id) => [id, { message: RACES[id].xpMessage, voice: RACES[id].xpVoice }])
	) as XpBoostConfig["race"],
	maxMultiplier: 10,
};

/** Lecture typée des réglages : `SettingsService` la satisfait. */
export interface SettingsReader {
	getInt(key: string, fallback: number): Promise<number>;
	getFloat(key: string, fallback: number): Promise<number>;
	getBool(key: string, fallback: boolean): Promise<boolean>;
	getString(key: string, fallback: string): Promise<string>;
}

const nonNegative = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
const ratio = (n: number) => Math.min(1, nonNegative(n));
const hour = (n: number) => ((Math.trunc(n) % 24) + 24) % 24;

export async function loadXpBoostConfig(s: SettingsReader): Promise<XpBoostConfig> {
	const d = DEFAULT_XP_BOOST_CONFIG;
	const race = {} as XpBoostConfig["race"];
	for (const id of RACE_IDS) {
		race[id] = {
			message: nonNegative(await s.getFloat(`xp.race.${id}.message`, d.race[id].message)),
			voice: nonNegative(await s.getFloat(`xp.race.${id}.voice`, d.race[id].voice)),
		};
	}
	return {
		voice: {
			minMembers: Math.max(1, await s.getInt("xp.voice.min_members", d.voice.minMembers)),
			mutedRatio: ratio(await s.getFloat("xp.voice.muted_ratio", d.voice.mutedRatio)),
			deafenedRatio: ratio(await s.getFloat("xp.voice.deafened_ratio", d.voice.deafenedRatio)),
		},
		group: {
			bonusPerMember: nonNegative(
				await s.getFloat("xp.voice.group.bonus_per_member", d.group.bonusPerMember)
			),
			maxMultiplier: Math.max(
				1,
				await s.getFloat("xp.voice.group.max_multiplier", d.group.maxMultiplier)
			),
		},
		night: {
			enabled: await s.getBool("xp.night.enabled", d.night.enabled),
			startHour: hour(await s.getInt("xp.night.start_hour", d.night.startHour)),
			endHour: hour(await s.getInt("xp.night.end_hour", d.night.endHour)),
			timezone:
				(await s.getString("xp.night.timezone", d.night.timezone)).trim() || d.night.timezone,
			voiceMultiplier: nonNegative(
				await s.getFloat("xp.night.voice_multiplier", d.night.voiceMultiplier)
			),
			messageMultiplier: nonNegative(
				await s.getFloat("xp.night.message_multiplier", d.night.messageMultiplier)
			),
		},
		sleepcall: {
			enabled: await s.getBool("xp.sleepcall.enabled", d.sleepcall.enabled),
			minMembers: Math.max(2, await s.getInt("xp.sleepcall.min_members", d.sleepcall.minMembers)),
			multiplier: nonNegative(await s.getFloat("xp.sleepcall.multiplier", d.sleepcall.multiplier)),
			announce: await s.getBool("xp.sleepcall.announce", d.sleepcall.announce),
			graceMinutes: nonNegative(
				await s.getInt("xp.sleepcall.grace_minutes", d.sleepcall.graceMinutes)
			),
			summaryMinMinutes: nonNegative(
				await s.getInt("xp.sleepcall.summary_min_minutes", d.sleepcall.summaryMinMinutes)
			),
		},
		zenkai: {
			multiplier: nonNegative(await s.getFloat("xp.zenkai.multiplier", d.zenkai.multiplier)),
			minutes: nonNegative(await s.getInt("xp.zenkai.minutes", d.zenkai.minutes)),
		},
		race,
		maxMultiplier: Math.max(1, await s.getFloat("xp.multiplier.max", d.maxMultiplier)),
	};
}

// ── Nuit ──────────────────────────────────────────────────────────────────

const hourFormats = new Map<string, Intl.DateTimeFormat>();

/** Heure locale (0-23) dans le fuseau donné ; UTC si le fuseau est inconnu. */
export function localHour(now: number, timeZone: string): number {
	let fmt = hourFormats.get(timeZone);
	if (!fmt) {
		try {
			fmt = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone });
		} catch {
			return new Date(now).getUTCHours();
		}
		hourFormats.set(timeZone, fmt);
	}
	return hour(Number.parseInt(fmt.format(now), 10));
}

/** Fenêtre horaire [début, fin[ qui peut passer minuit (22 → 7). Début = fin : jamais. */
export function isHourInWindow(h: number, start: number, end: number): boolean {
	if (start === end) return false;
	return start < end ? h >= start && h < end : h >= start || h < end;
}

export function isNight(now: number, cfg: XpBoostConfig): boolean {
	if (!cfg.night.enabled) return false;
	return isHourInWindow(localHour(now, cfg.night.timezone), cfg.night.startHour, cfg.night.endHour);
}

// ── Vocal ─────────────────────────────────────────────────────────────────

/** Statut micro d'un membre ; `null` s'il est coupé par un modérateur (sanction, pas d'XP). */
export function voiceStatusOf(state: {
	selfMute: boolean | null;
	selfDeaf: boolean | null;
	mute: boolean | null;
	deaf: boolean | null;
}): VoiceStatus | null {
	if (state.mute || state.deaf) return null;
	if (state.selfDeaf) return "deafened";
	if (state.selfMute) return "muted";
	return "open";
}

export function statusRatio(status: VoiceStatus, cfg: XpBoostConfig): number {
	if (status === "muted") return cfg.voice.mutedRatio;
	if (status === "deafened") return cfg.voice.deafenedRatio;
	return 1;
}

/**
 * Membres humains présents par salon vocal, hors salon AFK, hub des vocaux
 * éphémères et membres coupés par un modérateur.
 */
export function voicePresencesByChannel(
	guild: Guild,
	hubId?: string | null
): Map<string, VoicePresence[]> {
	const byChannel = new Map<string, VoicePresence[]>();
	for (const state of guild.voiceStates.cache.values()) {
		const channel = state.channel;
		if (!channel) continue;
		if (channel.id === guild.afkChannelId || (hubId && channel.id === hubId)) continue;
		const member = state.member ?? guild.members.cache.get(state.id);
		if (!member || member.user.bot) continue;
		const status = voiceStatusOf(state);
		if (!status) continue;
		const list = byChannel.get(channel.id) ?? [];
		list.push({ userId: state.id, status });
		byChannel.set(channel.id, list);
	}
	return byChannel;
}

export interface VoiceChannelContext {
	night: boolean;
	sleepcall: boolean;
	/** Membres qui gagnent de l'XP dans ce salon ; vide si le salon ne rapporte rien. */
	earners: VoicePresence[];
}

/**
 * Qui gagne dans un salon. La nuit, à partir de `sleepcall.minMembers`
 * présents, le salon passe en sleepcall : tout le monde gagne, micro et casque
 * coupés compris. Sinon seuls comptent les statuts dont la part est > 0, et le
 * salon ne rapporte qu'à partir de `voice.minMembers` d'entre eux.
 */
export function voiceChannelContext(
	presences: readonly VoicePresence[],
	cfg: XpBoostConfig,
	now: number
): VoiceChannelContext {
	const night = isNight(now, cfg);
	const sleepcall = night && cfg.sleepcall.enabled && presences.length >= cfg.sleepcall.minMembers;
	const earners = presences.filter((p) => sleepcall || statusRatio(p.status, cfg) > 0);
	if (earners.length < cfg.voice.minMembers) return { night, sleepcall: false, earners: [] };
	return { night, sleepcall, earners };
}

/** +`bonusPerMember` par membre au-delà du premier, plafonné à `maxMultiplier`. */
export function groupMultiplier(members: number, cfg: XpBoostConfig): number {
	const bonus = 1 + cfg.group.bonusPerMember * Math.max(0, members - 1);
	return Math.min(cfg.group.maxMultiplier, bonus);
}

// ── Assemblage ────────────────────────────────────────────────────────────

interface XpBoostPart {
	label: string;
	value: number;
}

export interface XpBoost {
	/** Multiplicateur final à appliquer au gain de base. */
	total: number;
	/** Facteurs ≠ 1, dans l'ordre d'application. */
	parts: XpBoostPart[];
	/** Le produit des facteurs dépassait le plafond. */
	capped: boolean;
}

/** Meilleur multiplicateur parmi les rôles boostés et le boost booster (ne se cumulent pas). */
export function bestRoleMultiplier(
	hasRole: (roleId: string) => boolean,
	roleBoosts: ReadonlyArray<{ roleId: string; multiplier: number }>,
	boosterMultiplier: number
): number {
	let best = Math.max(1, boosterMultiplier);
	for (const b of roleBoosts) {
		if (b.multiplier > best && hasRole(b.roleId)) best = b.multiplier;
	}
	return best;
}

interface BoostInput {
	roleMultiplier: number;
	race: string | null | undefined;
	raceBoostUntil: number;
	now: number;
}

function commonParts(input: BoostInput, kind: "message" | "voice", cfg: XpBoostConfig) {
	const parts: XpBoostPart[] = [];
	const push = (label: string, value: number) => {
		if (value !== 1) parts.push({ label, value });
	};
	push("Rôle ou booster", input.roleMultiplier);
	const race = getRace(input.race);
	if (race) {
		push(`Race ${race.name}`, cfg.race[race.id][kind]);
		if (race.zenkai && input.raceBoostUntil > input.now) push("Zenkai", cfg.zenkai.multiplier);
	}
	return { parts, push };
}

function finish(parts: XpBoostPart[], cfg: XpBoostConfig): XpBoost {
	const product = parts.reduce((m, p) => m * p.value, 1);
	return {
		total: Math.min(product, cfg.maxMultiplier),
		parts,
		capped: product > cfg.maxMultiplier,
	};
}

export function messageBoost(input: BoostInput, cfg: XpBoostConfig): XpBoost {
	const { parts, push } = commonParts(input, "message", cfg);
	if (isNight(input.now, cfg)) push("Nuit", cfg.night.messageMultiplier);
	return finish(parts, cfg);
}

export function voiceBoost(
	input: BoostInput & { status: VoiceStatus; channel: VoiceChannelContext },
	cfg: XpBoostConfig
): XpBoost {
	const { parts, push } = commonParts(input, "voice", cfg);
	push("Vocal à plusieurs", groupMultiplier(input.channel.earners.length, cfg));
	if (input.channel.sleepcall) push("Sleepcall", cfg.sleepcall.multiplier);
	else if (input.channel.night) push("Nuit", cfg.night.voiceMultiplier);
	const boost = finish(parts, cfg);
	if (input.channel.sleepcall) return boost;
	const share = statusRatio(input.status, cfg);
	if (share === 1) return boost;
	return {
		total: boost.total * share,
		parts: [
			...boost.parts,
			{ label: input.status === "muted" ? "Micro coupé" : "Casque coupé", value: share },
		],
		capped: boost.capped,
	};
}

/** `×2,5` */
export function formatMultiplier(n: number): string {
	return `×${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}
