/**
 * Tests du module pur lib/xp-boosts (vocal permissif, groupe, nuit, sleepcall).
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_XP_BOOST_CONFIG,
	bestRoleMultiplier,
	groupMultiplier,
	isHourInWindow,
	loadXpBoostConfig,
	localHour,
	messageBoost,
	voiceBoost,
	voiceChannelContext,
	voiceStatusOf,
	type SettingsReader,
	type VoicePresence,
	type XpBoostConfig,
} from "~/lib/xp-boosts";

const cfg = (patch: Partial<XpBoostConfig> = {}): XpBoostConfig => ({
	...structuredClone(DEFAULT_XP_BOOST_CONFIG),
	...patch,
});

// 2026-09-13 : 12 h UTC = 14 h à Paris ; 23 h UTC = 1 h à Paris.
const DAY = Date.UTC(2026, 8, 13, 12, 0);
const NIGHT = Date.UTC(2026, 8, 13, 23, 0);

const presences = (...statuses: VoicePresence["status"][]): VoicePresence[] =>
	statuses.map((status, i) => ({ userId: `u${i}`, status }));

describe("xp-boosts — nuit", () => {
	test("heure locale dans le fuseau, repli UTC si fuseau inconnu", () => {
		expect(localHour(NIGHT, "Europe/Paris")).toBe(1);
		expect(localHour(NIGHT, "Pas/Un_Fuseau")).toBe(23);
	});
	test("fenêtre simple et fenêtre qui passe minuit", () => {
		expect(isHourInWindow(0, 0, 7)).toBe(true);
		expect(isHourInWindow(7, 0, 7)).toBe(false);
		expect(isHourInWindow(23, 22, 6)).toBe(true);
		expect(isHourInWindow(3, 22, 6)).toBe(true);
		expect(isHourInWindow(12, 22, 6)).toBe(false);
		expect(isHourInWindow(5, 5, 5)).toBe(false);
	});
	test("boost de nuit sur les messages", () => {
		const input = { roleMultiplier: 1, race: null, raceBoostUntil: 0, now: NIGHT };
		expect(messageBoost(input, cfg()).total).toBeCloseTo(1.5);
		expect(messageBoost({ ...input, now: DAY }, cfg()).total).toBe(1);
		const off = cfg();
		off.night.enabled = false;
		expect(messageBoost(input, off).total).toBe(1);
	});
});

describe("xp-boosts — vocal permissif", () => {
	test("statut micro ; coupé par un modérateur = exclu", () => {
		const s = { selfMute: false, selfDeaf: false, mute: false, deaf: false };
		expect(voiceStatusOf(s)).toBe("open");
		expect(voiceStatusOf({ ...s, selfMute: true })).toBe("muted");
		expect(voiceStatusOf({ ...s, selfMute: true, selfDeaf: true })).toBe("deafened");
		expect(voiceStatusOf({ ...s, mute: true })).toBeNull();
		expect(voiceStatusOf({ ...s, deaf: true })).toBeNull();
	});
	test("seul en vocal, en journée : on gagne", () => {
		const ctx = voiceChannelContext(presences("open"), cfg(), DAY);
		expect(ctx.earners).toHaveLength(1);
		expect(ctx.sleepcall).toBe(false);
	});
	test("seuil de membres toujours réglable", () => {
		const c = cfg();
		c.voice.minMembers = 2;
		expect(voiceChannelContext(presences("open"), c, DAY).earners).toHaveLength(0);
		expect(voiceChannelContext(presences("open", "muted"), c, DAY).earners).toHaveLength(2);
	});
	test("casque coupé : moitié du gain par défaut, rien si la part vaut 0", () => {
		const c = cfg();
		const ctx = voiceChannelContext(presences("deafened"), c, DAY);
		const input = {
			roleMultiplier: 1,
			race: null,
			raceBoostUntil: 0,
			now: DAY,
			status: "deafened" as const,
			channel: ctx,
		};
		expect(voiceBoost(input, c).total).toBeCloseTo(0.5);
		c.voice.deafenedRatio = 0;
		expect(voiceChannelContext(presences("deafened"), c, DAY).earners).toHaveLength(0);
	});
	test("vocal à plusieurs : +10 % par membre, plafonné", () => {
		expect(groupMultiplier(1, cfg())).toBe(1);
		expect(groupMultiplier(4, cfg())).toBeCloseTo(1.3);
		expect(groupMultiplier(30, cfg())).toBe(2);
	});
});

describe("xp-boosts — sleepcall", () => {
	test("la nuit à deux, casques coupés : sleepcall plein pot", () => {
		const c = cfg();
		const ctx = voiceChannelContext(presences("deafened", "deafened"), c, NIGHT);
		expect(ctx.sleepcall).toBe(true);
		expect(ctx.earners).toHaveLength(2);
		const boost = voiceBoost(
			{
				roleMultiplier: 1,
				race: null,
				raceBoostUntil: 0,
				now: NIGHT,
				status: "deafened",
				channel: ctx,
			},
			c
		);
		// groupe ×1,1 × sleepcall ×2,5, sans réduction casque coupé.
		expect(boost.total).toBeCloseTo(2.75);
		expect(boost.parts.map((p) => p.label)).toEqual(["Vocal à plusieurs", "Sleepcall"]);
	});
	test("seul la nuit : boost de nuit, pas de sleepcall", () => {
		const c = cfg();
		const ctx = voiceChannelContext(presences("open"), c, NIGHT);
		expect(ctx.sleepcall).toBe(false);
		const boost = voiceBoost(
			{
				roleMultiplier: 1,
				race: null,
				raceBoostUntil: 0,
				now: NIGHT,
				status: "open",
				channel: ctx,
			},
			c
		);
		expect(boost.total).toBeCloseTo(1.5);
	});
	test("en journée, pas de sleepcall même à plusieurs", () => {
		expect(voiceChannelContext(presences("open", "open", "open"), cfg(), DAY).sleepcall).toBe(
			false
		);
	});
	test("plafond du multiplicateur cumulé", () => {
		const c = cfg();
		const ctx = voiceChannelContext(presences("open", "open", "open", "open", "open"), c, NIGHT);
		const boost = voiceBoost(
			{
				roleMultiplier: 3,
				race: "cyborg",
				raceBoostUntil: 0,
				now: NIGHT,
				status: "open",
				channel: ctx,
			},
			c
		);
		expect(boost.capped).toBe(true);
		expect(boost.total).toBe(10);
	});
});

describe("xp-boosts — rôles, races et réglages", () => {
	test("meilleur rôle ou booster, sans cumul", () => {
		const boosts = [
			{ roleId: "a", multiplier: 1.5 },
			{ roleId: "b", multiplier: 3 },
		];
		expect(bestRoleMultiplier((id) => id === "a", boosts, 1.25)).toBe(1.5);
		expect(bestRoleMultiplier(() => true, boosts, 1.25)).toBe(3);
		expect(bestRoleMultiplier(() => false, boosts, 1.25)).toBe(1.25);
		expect(bestRoleMultiplier(() => false, boosts, 0.5)).toBe(1);
	});
	test("race et Zenkai configurables", () => {
		const c = cfg();
		c.race.saiyan.message = 2;
		c.zenkai.multiplier = 3;
		const boost = messageBoost(
			{ roleMultiplier: 1, race: "saiyan", raceBoostUntil: DAY + 1, now: DAY },
			c
		);
		expect(boost.total).toBeCloseTo(6);
	});
	test("chargement : défauts, surcharges et bornes", async () => {
		const values: Record<string, string> = {
			"xp.voice.deafened_ratio": "4",
			"xp.night.start_hour": "25",
			"xp.race.cyborg.voice": "2",
			"xp.sleepcall.min_members": "1",
		};
		const reader: SettingsReader = {
			getInt: async (k, f) => (values[k] ? Number.parseInt(values[k]!, 10) : f),
			getFloat: async (k, f) => (values[k] ? Number.parseFloat(values[k]!) : f),
			getBool: async (k, f) => (values[k] ? values[k] === "true" : f),
			getString: async (k, f) => values[k] ?? f,
		};
		const loaded = await loadXpBoostConfig(reader);
		expect(loaded.voice.minMembers).toBe(1);
		expect(loaded.voice.deafenedRatio).toBe(1);
		expect(loaded.night.startHour).toBe(1);
		expect(loaded.race.cyborg.voice).toBe(2);
		expect(loaded.race.saiyan.voice).toBe(1.25);
		expect(loaded.sleepcall.minMembers).toBe(2);
	});
});
