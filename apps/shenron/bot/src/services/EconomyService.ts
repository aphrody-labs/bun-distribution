import { container, singleton, inject } from "tsyringe";
import { and, eq, gte, sql, desc, or } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { users, inventory, shopItems, fusions, achievements, actionLogs } from "~/db/schema";
import { FUSION_ZENI_BONUS_RATIO } from "~/lib/constants";
import { applyZeniRace } from "~/lib/races";
import { SettingsService } from "~/services/SettingsService";
import { AntiCheatService, type ZeniSource } from "~/services/AntiCheatService";
import { InflationService } from "~/services/InflationService";

@singleton()
export class EconomyService {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	private get db() {
		return this.dbs.db;
	}

	async ensureUser(userId: string) {
		await this.db.insert(users).values({ id: userId }).onConflictDoNothing();
	}

	async getBalance(userId: string): Promise<number> {
		await this.ensureUser(userId);
		const u = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
		return u?.zeni ?? 0;
	}

	/**
	 * Crédite des zénis. Point de passage UNIQUE de tous les gains, pour trois
	 * raisons qui n'existaient pas quand chaque source écrivait `users.zeni`
	 * elle-même :
	 *  - un compte gelé par l'anti-triche ne reçoit plus rien (hors admin et
	 *    restitution de mise) — le gel n'était vérifié nulle part ;
	 *  - chaque gain passe à l'anti-triche (`AntiCheatService.inspect` n'avait
	 *    aucun appelant) ;
	 *  - l'incrément est atomique (`zeni + n`) : les sources qui écrivaient
	 *    `user.zeni + n` depuis une lecture antérieure écrasaient les gains
	 *    concurrents.
	 */
	async addZeni(
		userId: string,
		amount: number,
		options: {
			propagateFusion?: boolean;
			kind?: "game" | "stake" | "other";
			/** Provenance du gain, pour l'anti-triche et le grand livre. */
			source?: ZeniSource;
			/** `false` quand l'appelant a déjà appliqué le multiplicateur de race. */
			applyRace?: boolean;
		} = {
			propagateFusion: true,
		}
	): Promise<number | undefined> {
		await this.ensureUser(userId);
		if (!Number.isFinite(amount)) throw new Error("Montant de zénis invalide.");
		amount = Math.trunc(amount);
		const isStake = options.kind === "stake";
		const source: ZeniSource = options.source ?? (options.kind === "game" ? "game" : "other");
		// `stake` = restitution d'une mise séquestrée : un transfert entre joueurs,
		// pas un gain. Aucun multiplicateur (sinon une mise de 1 M rapportait
		// 1,5 M à un Majin pour 1 M risqué) et aucune part de fusion.
		if (isStake) options = { ...options, propagateFusion: false };

		const u =
			amount > 0 ? await this.db.query.users.findFirst({ where: eq(users.id, userId) }) : null;
		if (amount > 0 && !isStake && source !== "admin" && u?.zeniFrozen) {
			await this.db.insert(actionLogs).values({
				userId,
				action: "ZENI_BLOCKED",
				reason: "Gains gelés par l'anti-triche",
				meta: JSON.stringify({ amount, source, kind: options.kind ?? "other" }),
			});
			return undefined;
		}
		// Multiplicateur de RACE : Terrien +25 % (général), Majin +50 % sur les jeux.
		if (amount > 0 && !isStake && options.applyRace !== false) {
			amount = applyZeniRace(u?.race, amount, options.kind === "game");
		}
		const [after] = await this.db
			.update(users)
			.set({ zeni: sql`${users.zeni} + ${amount}`, updatedAt: new Date() })
			.where(eq(users.id, userId))
			.returning({ zeni: users.zeni });
		if (amount > 0) {
			await this.db.insert(actionLogs).values({
				userId,
				action: "ZENI_GAIN",
				meta: JSON.stringify({ amount, kind: options.kind ?? "other", source }),
			});
			if (!isStake && source !== "admin") {
				await container.resolve(AntiCheatService).inspect({
					userId,
					amount,
					balanceAfter: Number(after?.zeni ?? 0),
					source,
					detail: options.kind,
				});
			}
		}

		if (options.propagateFusion && amount > 0) {
			const partner = await this.partnerOf(userId);
			if (partner) {
				const ratio = await this.settings.getFloat(
					"zeni.fusion.bonus_ratio",
					FUSION_ZENI_BONUS_RATIO
				);
				const bonus = Math.floor(amount * ratio);
				if (bonus > 0) {
					await this.addZeni(partner, bonus, { propagateFusion: false, source: "fusion" });
					return bonus;
				}
			}
		}
		return undefined;
	}

	async removeZeni(userId: string, amount: number): Promise<boolean> {
		await this.ensureUser(userId);
		if (!Number.isFinite(amount) || amount < 0) return false;
		// Débit conditionnel ATOMIQUE : la lecture puis l'écriture séparées
		// laissaient deux débits concurrents passer sur le même solde et le
		// rendre négatif (double-clic sur « Acheter », deux mises simultanées).
		const rows = await this.db
			.update(users)
			.set({ zeni: sql`${users.zeni} - ${amount}`, updatedAt: new Date() })
			.where(and(eq(users.id, userId), gte(users.zeni, amount)))
			.returning({ id: users.id });
		return rows.length > 0;
	}

	async setZeni(userId: string, amount: number) {
		await this.ensureUser(userId);
		await this.db
			.update(users)
			.set({ zeni: amount, updatedAt: new Date() })
			.where(eq(users.id, userId));
	}

	// Shop
	async listShop(type?: "card" | "badge" | "color" | "title" | "banner") {
		if (type) {
			return this.db
				.select()
				.from(shopItems)
				.where(and(eq(shopItems.enabled, true), eq(shopItems.type, type)));
		}
		return this.db.select().from(shopItems).where(eq(shopItems.enabled, true));
	}

	async getShopItem(key: string) {
		return this.db.query.shopItems.findFirst({ where: eq(shopItems.key, key) });
	}

	async setShopItemRole(key: string, roleId: string | null): Promise<boolean> {
		const exists = await this.getShopItem(key);
		if (!exists) return false;
		await this.db.update(shopItems).set({ roleId }).where(eq(shopItems.key, key));
		return true;
	}

	async upsertShopItem(item: {
		key: string;
		type: "card" | "badge" | "color" | "title" | "banner";
		name: string;
		description?: string | null;
		price: number;
		roleId?: string | null;
		enabled?: boolean;
	}) {
		await this.db
			.insert(shopItems)
			.values({
				key: item.key,
				type: item.type,
				name: item.name,
				description: item.description ?? null,
				price: item.price,
				roleId: item.roleId ?? null,
				enabled: item.enabled ?? true,
			})
			.onConflictDoUpdate({
				target: shopItems.key,
				set: {
					type: item.type,
					name: item.name,
					description: item.description ?? null,
					price: item.price,
					roleId: item.roleId ?? null,
					enabled: item.enabled ?? true,
				},
			});
	}

	async grantItem(
		userId: string,
		type: "card" | "badge" | "color" | "title" | "banner",
		key: string
	) {
		await this.ensureUser(userId);
		await this.db
			.insert(inventory)
			.values({ userId, itemType: type, itemKey: key })
			.onConflictDoNothing();
	}

	async removeItem(
		userId: string,
		type: "card" | "badge" | "color" | "title" | "banner",
		key: string
	) {
		await this.db
			.delete(inventory)
			.where(
				and(eq(inventory.userId, userId), eq(inventory.itemType, type), eq(inventory.itemKey, key))
			);
	}

	async ownsItem(
		userId: string,
		type: "card" | "badge" | "color" | "title" | "banner",
		key: string
	): Promise<boolean> {
		const row = await this.db.query.inventory.findFirst({
			where: and(
				eq(inventory.userId, userId),
				eq(inventory.itemType, type),
				eq(inventory.itemKey, key)
			),
		});
		return !!row;
	}

	async purchase(
		userId: string,
		itemKey: string
	): Promise<{ ok: boolean; reason?: string; price?: number; roleId?: string | null }> {
		const item = await this.getShopItem(itemKey);
		if (!item || !item.enabled) return { ok: false, reason: "Objet introuvable" };
		if (await this.ownsItem(userId, item.type, item.key))
			return { ok: false, reason: "Déjà possédé" };

		// Prix du jour : indexé sur l'inflation quand elle est active.
		const price = await container.resolve(InflationService).priceOf(item.price);
		const balance = await this.getBalance(userId);
		if (balance < price) return { ok: false, reason: `Solde insuffisant (${balance}/${price})` };

		const removed = await this.removeZeni(userId, price);
		if (!removed) return { ok: false, reason: "Solde insuffisant" };

		await this.db.insert(inventory).values({ userId, itemType: item.type, itemKey: item.key });
		await this.db.insert(actionLogs).values({
			userId,
			action: "SHOP_PURCHASE",
			meta: JSON.stringify({ item: item.key, price, basePrice: item.price }),
		});
		return { ok: true, price, roleId: item.roleId };
	}

	async listInventory(userId: string) {
		return this.db.select().from(inventory).where(eq(inventory.userId, userId));
	}

	async getUser(userId: string) {
		return this.db.query.users.findFirst({ where: eq(users.id, userId) });
	}

	async setEquipped(
		userId: string,
		type: "card" | "badge" | "color" | "title" | "banner",
		key: string | null
	) {
		await this.ensureUser(userId);
		const patch: Record<string, string | null> = {};
		if (type === "card") patch.equippedCard = key;
		if (type === "badge") patch.equippedBadge = key;
		if (type === "color") patch.equippedColor = key;
		if (type === "title") patch.equippedTitle = key;
		if (type === "banner") patch.equippedBanner = key;
		await this.db
			.update(users)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(users.id, userId));
	}

	/**
	 * Retire l'objet équipé d'un emplacement et renvoie sa clé (`null` si rien
	 * n'était équipé). Sans cette méthode, un objet équipé ne pouvait être que
	 * REMPLACÉ : un membre qui équipait une bannière n'avait plus aucun moyen de
	 * revenir à sa carte par défaut.
	 */
	async unequip(
		userId: string,
		type: "card" | "badge" | "color" | "title" | "banner"
	): Promise<string | null> {
		const user = await this.getUser(userId);
		const previous =
			type === "card"
				? user?.equippedCard
				: type === "badge"
					? user?.equippedBadge
					: type === "color"
						? user?.equippedColor
						: type === "title"
							? user?.equippedTitle
							: user?.equippedBanner;
		await this.setEquipped(userId, type, null);
		return previous ?? null;
	}

	async equip(
		userId: string,
		type: "card" | "badge" | "color" | "title" | "banner",
		key: string
	): Promise<boolean> {
		const isDefaultCard = type === "card" && (key === "default" || key === "card_default");
		if (!isDefaultCard && !(await this.ownsItem(userId, type, key))) return false;
		await this.ensureUser(userId);
		const patch: Record<string, string | null> = {};
		if (type === "card") patch.equippedCard = key;
		if (type === "badge") patch.equippedBadge = key;
		if (type === "color") patch.equippedColor = key;
		if (type === "title") patch.equippedTitle = key;
		if (type === "banner") patch.equippedBanner = key;
		await this.db
			.update(users)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(users.id, userId));
		return true;
	}

	// Fusion
	async getFusion(userId: string) {
		return this.db.query.fusions.findFirst({
			where: (f, { or, eq: e }) => or(e(f.userA, userId), e(f.userB, userId)),
		});
	}

	async partnerOf(userId: string): Promise<string | null> {
		const f = await this.getFusion(userId);
		if (!f) return null;
		return f.userA === userId ? f.userB : f.userA;
	}

	async createFusion(a: string, b: string) {
		const [userA, userB] = [a, b].toSorted();
		await this.db.insert(fusions).values({ userA, userB }).onConflictDoNothing();
	}

	async breakFusion(userId: string) {
		const f = await this.getFusion(userId);
		if (!f) return false;
		await this.db.delete(fusions).where(eq(fusions.id, f.id));
		return true;
	}

	async listAllFusions() {
		return this.db.select().from(fusions);
	}

	// Succès
	async grantAchievement(userId: string, code: string): Promise<boolean> {
		await this.ensureUser(userId);
		try {
			await this.db.insert(achievements).values({ userId, code });
			return true;
		} catch {
			return false; // déjà attribué
		}
	}

	async revokeAchievement(userId: string, code: string) {
		await this.db
			.delete(achievements)
			.where(and(eq(achievements.userId, userId), eq(achievements.code, code)));
	}

	async listAchievements(userId: string) {
		return this.db.select().from(achievements).where(eq(achievements.userId, userId));
	}

	// Classements
	async topRich(limit = 10) {
		return this.db.select().from(users).orderBy(desc(users.zeni)).limit(limit);
	}

	async listRegisteredIds(): Promise<string[]> {
		const rows = await this.db.select({ id: users.id }).from(users);
		return rows.map((r) => r.id);
	}
}
