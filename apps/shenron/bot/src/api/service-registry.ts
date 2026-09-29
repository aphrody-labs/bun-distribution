import { container } from "tsyringe";
import { AchievementService } from "~/services/AchievementService";
import { EconomyService } from "~/services/EconomyService";
import { LevelService } from "~/services/LevelService";
import { SettingsService } from "~/services/SettingsService";
import { TranslateService } from "~/services/TranslateService";
import { ModerationService } from "~/services/ModerationService";
import { WikiService } from "~/services/WikiService";

/**
 * Whitelist d'actions exposables côté dashboard. Évite de laisser le dashboard
 * appeler n'importe quelle méthode d'un singleton arbitraire (RCE-grade hole).
 *
 * Convention : `service.action(...args)` où args est l'objet `body` JSON
 * du POST. Validation dans chaque action handler.
 */

interface ServiceAction {
	service: string;
	action: string;
	description: string;
	handler: (body: any) => Promise<unknown>;
}

/** Plafond d'un octroi manuel : au-delà, c'est une faute de frappe, pas une dotation. */
const MAX_MANUAL_GRANT = 1_000_000_000_000;

function assertGrant(userId: unknown, amount: unknown, unit: string): asserts amount is number {
	if (!userId || typeof amount !== "number" || !Number.isFinite(amount)) {
		throw new Error("userId + amount (nombre fini) requis.");
	}
	if (Math.abs(amount) > MAX_MANUAL_GRANT) {
		throw new Error(`Montant refusé : ${amount} ${unit} dépasse le plafond d'un octroi manuel.`);
	}
}

export const SERVICE_ACTIONS: ServiceAction[] = [
	// ── AchievementService ────────────────────────────────────────────────
	{
		service: "achievements",
		action: "refresh",
		description: "Recharge le cache des triggers regex depuis la DB",
		handler: async () => {
			const svc = container.resolve(AchievementService);
			await svc.refresh();
			return { ok: true };
		},
	},
	{
		service: "achievements",
		action: "list",
		description: "Liste les triggers chargés",
		handler: async () => {
			const svc = container.resolve(AchievementService);
			return await svc.list();
		},
	},
	{
		service: "achievements",
		action: "grant",
		description: "Force l'attribution d'un succès. Body: { userId: string, code: string }",
		handler: async ({ userId, code }: { userId: string; code: string }) => {
			if (!userId || !code) throw new Error("userId + code requis.");
			const eco = container.resolve(EconomyService);
			const granted = await eco.grantAchievement(userId, code);
			return { granted };
		},
	},

	// ── EconomyService ────────────────────────────────────────────────────
	{
		service: "economy",
		action: "addZeni",
		description: "Body: { userId, amount }",
		handler: async ({ userId, amount }: { userId: string; amount: number }) => {
			assertGrant(userId, amount, "zénis");
			const svc = container.resolve(EconomyService);
			await svc.addZeni(userId, amount, { propagateFusion: false, source: "admin" });
			return { ok: true };
		},
	},
	{
		service: "economy",
		action: "removeZeni",
		description: "Body: { userId, amount }",
		handler: async ({ userId, amount }: { userId: string; amount: number }) => {
			if (!userId || typeof amount !== "number") throw new Error("userId + amount requis.");
			const svc = container.resolve(EconomyService);
			await svc.removeZeni(userId, amount);
			return { ok: true };
		},
	},

	// ── LevelService ──────────────────────────────────────────────────────
	{
		service: "level",
		action: "addXP",
		description: "Body: { userId, amount }. Trigger le level-up si seuil franchi.",
		handler: async ({ userId, amount }: { userId: string; amount: number }) => {
			assertGrant(userId, amount, "XP");
			const svc = container.resolve(LevelService);
			// Un octroi admin ne propage PAS la fusion : c'est ainsi que le +8,5 × 10²⁴
			// du 2026-09-11 a aussi crédité le partenaire de 4,25 × 10²⁴.
			return await svc.addXP(userId, amount, { propagateFusion: false, source: "admin" });
		},
	},
	{
		service: "level",
		action: "getUser",
		description: "Body: { userId }",
		handler: async ({ userId }: { userId: string }) => {
			if (!userId) throw new Error("userId requis.");
			const svc = container.resolve(LevelService);
			return await svc.getUser(userId);
		},
	},

	// ── SettingsService ───────────────────────────────────────────────────
	{
		service: "settings",
		action: "list",
		description: "Liste tous les overrides runtime",
		handler: async () => {
			const svc = container.resolve(SettingsService);
			return await svc.list();
		},
	},
	{
		service: "settings",
		action: "set",
		description: "Body: { key, value }",
		handler: async ({ key, value }: { key: string; value: string }) => {
			const svc = container.resolve(SettingsService);
			await svc.set(key, value);
			return { ok: true };
		},
	},
	{
		service: "settings",
		action: "unset",
		description: "Body: { key }",
		handler: async ({ key }: { key: string }) => {
			const svc = container.resolve(SettingsService);
			await svc.unset(key);
			return { ok: true };
		},
	},

	// ── TranslateService ──────────────────────────────────────────────────
	{
		service: "translate",
		action: "probe",
		description: "Re-probe Aphrody OCR + services de traduction",
		handler: async () => {
			const svc = container.resolve(TranslateService);
			return await svc.probe();
		},
	},

	// ── ModerationService ─────────────────────────────────────────────────
	{
		service: "moderation",
		action: "countWarns",
		description: "Body: { userId } — nombre de warns actifs",
		handler: async ({ userId }: { userId: string }) => {
			if (!userId) throw new Error("userId requis.");
			const svc = container.resolve(ModerationService);
			return { count: await svc.countWarns(userId) };
		},
	},
	{
		service: "moderation",
		action: "removeLastWarn",
		description: "Body: { userId }",
		handler: async ({ userId }: { userId: string }) => {
			if (!userId) throw new Error("userId requis.");
			const svc = container.resolve(ModerationService);
			return { removed: await svc.removeLastWarn(userId) };
		},
	},

	// ── WikiService ───────────────────────────────────────────────────────
	{
		service: "wiki",
		action: "search",
		description: "Body: { query: string, limit?: 25 }",
		handler: async ({ query, limit }: { query: string; limit?: number }) => {
			if (!query) throw new Error("query requis.");
			const svc = container.resolve(WikiService);
			return await svc.search(query, limit ?? 25);
		},
	},
	{
		service: "wiki",
		action: "count",
		description: "Stats wiki (chars/trans/planets)",
		handler: async () => {
			const svc = container.resolve(WikiService);
			return await svc.count();
		},
	},
];

export function findAction(service: string, action: string): ServiceAction | undefined {
	return SERVICE_ACTIONS.find((a) => a.service === service && a.action === action);
}

export function listServiceActions(): Array<{
	service: string;
	action: string;
	description: string;
}> {
	return SERVICE_ACTIONS.map(({ service, action, description }) => ({
		service,
		action,
		description,
	}));
}
