import { canAfford } from "@rosegriffon/achillea-core";
import { sql as sqlTag, type Generated, type Kysely } from "kysely";
// The workspace package is runtime-resolved by Bun; the bot's legacy Node10
// resolver cannot follow its export map, so keep the boundary typed locally.
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { singleton } from "tsyringe";

import { TransactionType } from "@/utils/enums";

type WalletTable = {
	id: Generated<string>;
	user_id: string;
	balance: string;
	currency: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
};
type TransactionRow = {
	tid: string;
	type: TransactionType;
	amount: string;
	reason: string | null;
	from_user_id: string | null;
	to_user_id: string | null;
	metadata: Record<string, unknown> | null;
	created_at: Date;
};
type WalletDatabase = {
	wallet: WalletTable;
	transaction: {
		id: Generated<string>;
		type: TransactionType;
		amount: string;
		reason: string | null;
		from_user_id: string | null;
		to_user_id: string | null;
		metadata: Record<string, unknown> | null;
		created_at: Generated<Date>;
	};
	user: { id: string };
};

const sql = createAchilleaSql() as Kysely<WalletDatabase>;

export class InsufficientBalanceError extends Error {
	constructor(userId: string, required: number, available: number) {
		super(`Insufficient balance for user ${userId}: required ${required}, available ${available}`);
		this.name = "InsufficientBalanceError";
	}
}

export type WalletRecord = {
	id: string;
	user_id: string;
	balance: string;
	currency: string;
	created_at: Date;
	updated_at: Date;
};
export type WalletTransactionRecord = {
	id: string;
	type: TransactionType;
	amount: string;
	reason: string | null;
	fromUser: { id: string } | null;
	toUser: { id: string } | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
};

function asTransaction(row: TransactionRow): WalletTransactionRecord {
	return {
		id: row.tid,
		type: row.type,
		amount: row.amount,
		reason: row.reason,
		fromUser: row.from_user_id ? { id: row.from_user_id } : null,
		toUser: row.to_user_id ? { id: row.to_user_id } : null,
		metadata: row.metadata,
		createdAt: row.created_at,
	};
}

@singleton()
export class WalletService {
	async getOrCreate(userId: string): Promise<WalletRecord> {
		const inserted = await sql
			.insertInto("wallet")
			.values({ user_id: userId, balance: "0.00", currency: "ACH" })
			.onConflict((oc) => oc.column("user_id").doNothing())
			.returningAll()
			.executeTakeFirst();
		if (inserted) return inserted;
		return sql
			.selectFrom("wallet")
			.selectAll()
			.where("user_id", "=", userId)
			.executeTakeFirstOrThrow();
	}

	async getBalance(userId: string): Promise<number> {
		return Number((await this.getOrCreate(userId)).balance);
	}

	async credit(userId: string, amount: number, reason: string, metadata?: Record<string, unknown>) {
		if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("amount must be positive");
		return sql.transaction().execute(async (trx) => {
			await trx
				.updateTable("wallet")
				.set({ balance: sqlTag<string>`round(balance + ${amount}, 2)`, updated_at: new Date() })
				.where("user_id", "=", userId)
				.executeTakeFirstOrThrow();
			const row = await trx
				.insertInto("transaction")
				.values({ type: TransactionType.Credit, amount: amount.toFixed(2), reason, to_user_id: userId, from_user_id: null, metadata: metadata ?? null })
				.returning(["id as tid", "type", "amount", "reason", "from_user_id", "to_user_id", "metadata", "created_at"])
				.executeTakeFirstOrThrow();
			return asTransaction(row);
		});
	}

	async debit(userId: string, amount: number, reason: string, metadata?: Record<string, unknown>) {
		if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("amount must be positive");
		return sql.transaction().execute(async (trx) => {
			const wallet = await trx.selectFrom("wallet").select(["balance"]).where("user_id", "=", userId).forUpdate().executeTakeFirstOrThrow();
			const balance = Number(wallet.balance);
			if (!canAfford({ balance, currency: "ACH" }, amount)) throw new InsufficientBalanceError(userId, amount, balance);
			await trx.updateTable("wallet").set({ balance: sqlTag<string>`round(balance - ${amount}, 2)`, updated_at: new Date() }).where("user_id", "=", userId).executeTakeFirstOrThrow();
			const row = await trx
				.insertInto("transaction")
				.values({ type: TransactionType.Debit, amount: amount.toFixed(2), reason, from_user_id: userId, to_user_id: null, metadata: metadata ?? null })
				.returning(["id as tid", "type", "amount", "reason", "from_user_id", "to_user_id", "metadata", "created_at"])
				.executeTakeFirstOrThrow();
			return asTransaction(row);
		});
	}

	async transfer(fromUserId: string, toUserId: string, amount: number, reason: string) {
		if (fromUserId === toUserId) throw new Error("Cannot transfer to the same user");
		if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("amount must be positive");
		return sql.transaction().execute(async (trx) => {
			const wallets = await trx.selectFrom("wallet").select(["user_id", "balance"]).where("user_id", "in", [fromUserId, toUserId].sort()).orderBy("user_id").forUpdate().execute();
			const from = wallets.find((wallet) => wallet.user_id === fromUserId);
			const to = wallets.find((wallet) => wallet.user_id === toUserId);
			if (!from || !to) throw new Error("Wallet not found");
			const balance = Number(from.balance);
			if (!canAfford({ balance, currency: "ACH" }, amount)) throw new InsufficientBalanceError(fromUserId, amount, balance);
			await trx.updateTable("wallet").set({ balance: sqlTag<string>`round(balance - ${amount}, 2)`, updated_at: new Date() }).where("user_id", "=", fromUserId).execute();
			await trx.updateTable("wallet").set({ balance: sqlTag<string>`round(balance + ${amount}, 2)`, updated_at: new Date() }).where("user_id", "=", toUserId).execute();
			const base = { type: TransactionType.Transfer, amount: amount.toFixed(2), reason, from_user_id: fromUserId, to_user_id: toUserId, metadata: null } as const;
			const rows = await trx.insertInto("transaction").values([base, base]).returning(["id as tid", "type", "amount", "reason", "from_user_id", "to_user_id", "metadata", "created_at"]).execute();
			if (rows.length !== 2) throw new Error("Transfer transaction insert failed");
			return { from: asTransaction(rows[0]), to: asTransaction(rows[1]) };
		});
	}

	async getHistory(userId: string, limit = 20, offset = 0) {
		const rows = await sql.selectFrom("transaction").select(["id as tid", "type", "amount", "reason", "from_user_id", "to_user_id", "metadata", "created_at"]).where((eb) => eb.or([eb("from_user_id", "=", userId), eb("to_user_id", "=", userId)])).orderBy("created_at", "desc").limit(limit).offset(offset).execute();
		return rows.map(asTransaction);
	}
}
