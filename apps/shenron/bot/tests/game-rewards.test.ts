/**
 * Garde-fous économiques des mini-jeux, contre la vraie base de test :
 * mise restituée sans multiplicateur de race, plafonds anti-collusion.
 */
import "./setup"; // must be first
import { describe, expect, test } from "bun:test";
import { container } from "tsyringe";
import { eq } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { actionLogs, users } from "~/db/schema";

const { EconomyService } = await import("~/services/EconomyService");
const { GameRewardService } = await import("~/services/GameRewardService");

describe("mini-jeux — économie", () => {
	const dbs = container.resolve(DatabaseService);
	const eco = container.resolve(EconomyService);
	const rewards = container.resolve(GameRewardService);

	async function freshMajin(id: string) {
		await dbs.db.delete(actionLogs).where(eq(actionLogs.userId, id));
		await eco.ensureUser(id);
		await dbs.db.update(users).set({ zeni: 0, race: "majin" }).where(eq(users.id, id));
	}

	test("une mise restituée n'est pas multipliée par la race (farm Majin ×1,5)", async () => {
		const id = "test-stake-majin";
		await freshMajin(id);
		await eco.addZeni(id, 1_000_000, { kind: "stake" });
		expect(await eco.getBalance(id)).toBe(1_000_000);
		// Témoin : un vrai gain de jeu reste bien bonifié.
		await eco.addZeni(id, 100, { kind: "game" });
		expect(await eco.getBalance(id)).toBe(1_000_150);
	});

	test("séquestre : pot rendu au gagnant, rien de créé", async () => {
		const [a, b] = ["test-escrow-a", "test-escrow-b"];
		for (const id of [a, b]) await freshMajin(id);
		await dbs.db.update(users).set({ zeni: 1_000 }).where(eq(users.id, a));
		await dbs.db.update(users).set({ zeni: 1_000 }).where(eq(users.id, b));
		expect(await rewards.escrowStakes(a, b, 400)).toBe(true);
		expect(await eco.getBalance(a)).toBe(600);
		await rewards.payStakes("win", a, b, 400);
		expect((await eco.getBalance(a)) + (await eco.getBalance(b))).toBe(2_000);
		// Fonds insuffisants chez le second : le premier est remboursé.
		expect(await rewards.escrowStakes(a, b, 900)).toBe(false);
		expect(await eco.getBalance(a)).toBe(1_400);
	});

	test("collusion : au-delà du plafond de paire, la victoire ne rapporte plus", async () => {
		const [main, alt] = ["test-pair-main", "test-pair-alt"];
		await freshMajin(main);
		const results = [];
		for (let i = 0; i < 4; i++) {
			results.push(await rewards.grantWin({ userId: main, amount: 150, opponentId: alt }));
		}
		expect(results.slice(0, 3).every((r) => r.paid === 150)).toBe(true);
		expect(results[3]).toEqual({ paid: 0, blocked: "pair-cap" });
	});

	test("plafond quotidien compté dans le grand livre", async () => {
		const id = "test-daily-cap";
		await freshMajin(id);
		await dbs.db.insert(actionLogs).values(
			Array.from({ length: 20 }, () => ({
				userId: id,
				action: "ZENI_GAIN",
				meta: JSON.stringify({ amount: 150, kind: "game" }),
			}))
		);
		expect(await rewards.rewardedWinsLastDay(id)).toBe(20);
		expect(await rewards.grantWin({ userId: id, amount: 150 })).toEqual({
			paid: 0,
			blocked: "daily-cap",
		});
		expect(await eco.getBalance(id)).toBe(0);
	});
});
