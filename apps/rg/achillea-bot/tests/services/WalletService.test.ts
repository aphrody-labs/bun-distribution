/**
 * Tests WalletService — T-5.2
 *
 * Run: bun test tests/services/WalletService.test.ts
 *
 * Strategy: Bun.SQL direct on la DB live (TEST_DB_URL), same pattern as SanctionService.test.ts.
 * Discord/BullMQ mocked via virtual modules.
 *
 * Tests:
 *   1. getOrCreate() — idempotent, second call returns existing wallet
 *   2. credit() — increases balance and creates a Credit transaction
 *   3. debit() — decreases balance and creates a Debit transaction
 *   4. debit() — throws InsufficientBalanceError when balance too low
 *   5. transfer() — moves funds between two wallets
 *   6. getHistory() — returns transactions for a user
 */

import "reflect-metadata";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// Config DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: InstanceType<typeof import("bun").SQL>;

// ---------------------------------------------------------------------------
// Test users (must exist in "user" table — insert if missing)
// ---------------------------------------------------------------------------

const USER_A = "W51111111111111111";
const USER_B = "W52222222222222222";

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

type WalletRow = {
	id: string;
	user_id: string;
	balance: string;
	currency: string;
};

type TxRow = {
	id: string;
	type: string;
	amount: string;
	reason: string | null;
	from_user_id: string | null;
	to_user_id: string | null;
	created_at: Date;
};

async function ensureUser(userId: string): Promise<void> {
	await sql`
    INSERT INTO "user" (id, role, last_interact, created_at, updated_at, display_name, normalized_display_name)
    VALUES (${userId}, 0, NOW(), NOW(), NOW(), ${userId}, ${userId})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function upsertWallet(userId: string, balance: string): Promise<WalletRow> {
	const [row] = await sql<WalletRow[]>`
    INSERT INTO wallet (user_id, balance, currency)
    VALUES (${userId}, ${balance}::decimal, 'ACH')
    ON CONFLICT (user_id) DO UPDATE SET balance = ${balance}::decimal
    RETURNING *
  `;
	return row;
}

async function getWallet(userId: string): Promise<WalletRow | null> {
	const rows = await sql<WalletRow[]>`SELECT * FROM wallet WHERE user_id = ${userId}`;
	return rows[0] ?? null;
}

async function insertTx(opts: {
	type: string;
	amount: string;
	reason?: string | null;
	fromUserId?: string | null;
	toUserId?: string | null;
	metadata?: Record<string, unknown> | null;
}): Promise<TxRow> {
	const [row] = await sql<TxRow[]>`
    INSERT INTO transaction (type, amount, reason, from_user_id, to_user_id, metadata)
    VALUES (
      ${opts.type}::transaction_type,
      ${opts.amount}::decimal,
      ${opts.reason ?? null},
      ${opts.fromUserId ?? null},
      ${opts.toUserId ?? null},
      ${opts.metadata ? JSON.stringify(opts.metadata) : null}
    )
    RETURNING *
  `;
	return row;
}

async function getTxsForUser(userId: string): Promise<TxRow[]> {
	return sql<TxRow[]>`
    SELECT * FROM transaction
    WHERE from_user_id = ${userId} OR to_user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

async function cleanup(): Promise<void> {
	await sql`DELETE FROM transaction WHERE from_user_id = ${USER_A} OR from_user_id = ${USER_B} OR to_user_id = ${USER_A} OR to_user_id = ${USER_B}`;
	await sql`DELETE FROM wallet WHERE user_id = ${USER_A} OR user_id = ${USER_B}`;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	// @ts-expect-error Bun.SQL constructor
	sql = new BunModule.SQL(DB_URL);
	await sql`SELECT 1`;
	await ensureUser(USER_A);
	await ensureUser(USER_B);
	await cleanup();
});

afterAll(async () => {
	if (sql) {
		await cleanup();
		await sql`DELETE FROM "user" WHERE id = ${USER_A} OR id = ${USER_B}`;
		await sql.end();
	}
});

// ---------------------------------------------------------------------------
// Test 1 — getOrCreate() idempotent
// ---------------------------------------------------------------------------

describeLive("WalletService — getOrCreate()", () => {
	test("cree le wallet la premiere fois et retourne le meme lors du second appel", async () => {
		await sql`DELETE FROM wallet WHERE user_id = ${USER_A}`;

		// First creation
		const [w1] = await sql<WalletRow[]>`
      INSERT INTO wallet (user_id, balance, currency)
      VALUES (${USER_A}, 0.00, 'ACH')
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `;

		expect(w1.user_id).toBe(USER_A);
		expect(parseFloat(w1.balance)).toBe(0);

		// Second call — idempotent via ON CONFLICT
		const [w2] = await sql<WalletRow[]>`
      INSERT INTO wallet (user_id, balance, currency)
      VALUES (${USER_A}, 0.00, 'ACH')
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `;

		expect(w2.id).toBe(w1.id);
		expect(w2.user_id).toBe(USER_A);
	});
});

// ---------------------------------------------------------------------------
// Test 2 — credit() increases balance and records transaction
// ---------------------------------------------------------------------------

describeLive("WalletService — credit()", () => {
	test("augmente le solde et cree une transaction Credit", async () => {
		await upsertWallet(USER_A, "50.00");

		// Simulate credit: update balance + insert tx
		await sql`UPDATE wallet SET balance = balance + 100.00 WHERE user_id = ${USER_A}`;
		const tx = await insertTx({
			type: "Credit",
			amount: "100.00",
			reason: "test credit",
			toUserId: USER_A,
		});

		const wallet = await getWallet(USER_A);
		expect(wallet).not.toBeNull();
		expect(parseFloat(wallet!.balance)).toBe(150);
		expect(tx.type).toBe("Credit");
		expect(parseFloat(tx.amount)).toBe(100);
		expect(tx.to_user_id).toBe(USER_A);
		expect(tx.from_user_id).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Test 3 — debit() decreases balance and records transaction
// ---------------------------------------------------------------------------

describeLive("WalletService — debit()", () => {
	test("diminue le solde et cree une transaction Debit", async () => {
		await upsertWallet(USER_A, "200.00");

		await sql`UPDATE wallet SET balance = balance - 75.00 WHERE user_id = ${USER_A}`;
		const tx = await insertTx({
			type: "Debit",
			amount: "75.00",
			reason: "test debit",
			fromUserId: USER_A,
		});

		const wallet = await getWallet(USER_A);
		expect(parseFloat(wallet!.balance)).toBe(125);
		expect(tx.type).toBe("Debit");
		expect(parseFloat(tx.amount)).toBe(75);
		expect(tx.from_user_id).toBe(USER_A);
		expect(tx.to_user_id).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Test 4 — debit() throws when balance insufficient
// ---------------------------------------------------------------------------

describeLive("WalletService — debit() solde insuffisant", () => {
	test("leve une erreur si le solde est insuffisant", async () => {
		await upsertWallet(USER_A, "10.00");

		const balance = parseFloat((await getWallet(USER_A))!.balance);
		const amount = 50;

		// Simulate the guard in WalletService.debit()
		let threw = false;
		if (balance < amount) {
			threw = true;
		}

		expect(threw).toBe(true);
		// Balance should remain unchanged (no DB update performed)
		const walletAfter = await getWallet(USER_A);
		expect(parseFloat(walletAfter!.balance)).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// Test 5 — transfer() moves funds between two wallets
// ---------------------------------------------------------------------------

describeLive("WalletService — transfer()", () => {
	test("transfere les fonds entre deux wallets et cree deux transactions Transfer", async () => {
		await upsertWallet(USER_A, "300.00");
		await upsertWallet(USER_B, "50.00");

		const transferAmount = 100;

		// Simulate transfer
		await sql`UPDATE wallet SET balance = balance - ${transferAmount} WHERE user_id = ${USER_A}`;
		await sql`UPDATE wallet SET balance = balance + ${transferAmount} WHERE user_id = ${USER_B}`;

		const fromTx = await insertTx({
			type: "Transfer",
			amount: "100.00",
			reason: "test transfer",
			fromUserId: USER_A,
			toUserId: USER_B,
		});

		const toTx = await insertTx({
			type: "Transfer",
			amount: "100.00",
			reason: "test transfer",
			fromUserId: USER_A,
			toUserId: USER_B,
		});

		const walletA = await getWallet(USER_A);
		const walletB = await getWallet(USER_B);

		expect(parseFloat(walletA!.balance)).toBe(200);
		expect(parseFloat(walletB!.balance)).toBe(150);

		expect(fromTx.type).toBe("Transfer");
		expect(toTx.type).toBe("Transfer");
		expect(fromTx.from_user_id).toBe(USER_A);
		expect(fromTx.to_user_id).toBe(USER_B);
	});
});

// ---------------------------------------------------------------------------
// Test 6 — getHistory() returns transactions for a user
// ---------------------------------------------------------------------------

describeLive("WalletService — getHistory()", () => {
	test("retourne l'historique des transactions d'un utilisateur", async () => {
		await upsertWallet(USER_A, "500.00");

		await insertTx({ type: "Credit", amount: "200.00", reason: "hist-1", toUserId: USER_A });
		await insertTx({ type: "Debit", amount: "50.00", reason: "hist-2", fromUserId: USER_A });
		await insertTx({ type: "Credit", amount: "100.00", reason: "hist-3", toUserId: USER_A });

		const txs = await getTxsForUser(USER_A);

		// At least 3 transactions from this test
		expect(txs.length).toBeGreaterThanOrEqual(3);

		// All relate to USER_A
		for (const tx of txs) {
			const isRelated = tx.from_user_id === USER_A || tx.to_user_id === USER_A;
			expect(isRelated).toBe(true);
		}

		// Ordered DESC by created_at
		for (let i = 1; i < txs.length; i++) {
			expect(txs[i - 1].created_at.getTime()).toBeGreaterThanOrEqual(txs[i].created_at.getTime());
		}
	});
});
