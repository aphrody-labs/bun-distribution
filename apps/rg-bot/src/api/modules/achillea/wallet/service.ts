import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

export abstract class WalletService {
  static async getOrCreate(db: Kysely<Database>, userId: string) {
    const inserted = await db
      .insertInto("wallet")
      .values({ user_id: userId, balance: "0.00", currency: "ACH" })
      .onConflict(oc => oc.column("user_id").doNothing())
      .returningAll()
      .executeTakeFirst();
    return (
      inserted ?? (await db.selectFrom("wallet").selectAll().where("user_id", "=", userId).executeTakeFirstOrThrow())
    );
  }

  static async history(db: Kysely<Database>, userId: string, limit: number, offset: number) {
    const rows = await db
      .selectFrom("transaction")
      .select(["id", "type", "amount", "reason", "from_user_id", "to_user_id", "created_at"])
      .where(eb => eb.or([eb("from_user_id", "=", userId), eb("to_user_id", "=", userId)]))
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();
    return rows.map(row => ({
      id: String(row.id),
      type: String(row.type),
      amount: Number(row.amount),
      reason: row.reason,
      direction: row.from_user_id === userId ? ("out" as const) : ("in" as const),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
