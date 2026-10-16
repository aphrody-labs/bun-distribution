import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

type Filters = { userId?: string; guildId?: string; type?: string; active?: boolean; page?: number; pageSize?: number };

function dto(row: any) {
	return {
		id: row.id, userId: row.user_id, guildId: row.guild_id, type: row.type, reason: row.reason,
		durationSec: row.duration_sec, issuedBy: row.issued_by, issuedByType: row.issued_by_type,
		expiresAt: row.expires_at?.toISOString?.() ?? null, revokedAt: row.revoked_at?.toISOString?.() ?? null,
		revokedBy: row.revoked_by, revokeReason: row.revoke_reason, evidence: row.evidence,
		createdAt: row.created_at.toISOString(),
	};
}

export abstract class SanctionService {
	static async list(db: Kysely<Database>, filters: Filters) {
		const page = Math.max(1, filters.page ?? 1);
		const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
		let query = db.selectFrom("sanction").selectAll();
		if (filters.userId) query = query.where("user_id", "=", filters.userId);
		if (filters.guildId) query = query.where("guild_id", "=", filters.guildId);
		if (filters.type) query = query.where("type", "=", filters.type);
		if (filters.active === true) query = query.where("revoked_at", "is", null).where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())]));
		if (filters.active === false) query = query.where((eb) => eb.or([eb("revoked_at", "is not", null), eb("expires_at", "<=", new Date())]));
		const [rows, count] = await Promise.all([
			query.orderBy("created_at", "desc").limit(pageSize).offset((page - 1) * pageSize).execute(),
			db.selectFrom("sanction").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirst(),
		]);
		const total = Number(count?.count ?? 0);
		return { data: rows.map(dto), total, meta: { page, pageSize, pageCount: Math.ceil(total / pageSize) } };
	}

	static async create(db: Kysely<Database>, input: { userId: string; guildId: string; type: string; reason?: string | null; durationSec?: number | null; issuedBy: string; evidence?: Record<string, unknown>[] | null }) {
		const expiresAt = input.durationSec ? new Date(Date.now() + input.durationSec * 1000) : null;
		const row = await db.insertInto("sanction").values({
			user_id: input.userId, guild_id: input.guildId, type: input.type, reason: input.reason ?? null,
			duration_sec: input.durationSec ?? null, issued_by: input.issuedBy, issued_by_type: "staff",
			expires_at: expiresAt, revoked_at: null, revoked_by: null, revoke_reason: null, evidence: input.evidence ?? null,
		}).returningAll().executeTakeFirstOrThrow();
		return dto(row);
	}

	static async revoke(db: Kysely<Database>, id: string, by: string, reason?: string) {
		const row = await db.updateTable("sanction").set({ revoked_at: new Date(), revoked_by: by, revoke_reason: reason ?? null, updated_at: new Date() }).where("id", "=", id).where("revoked_at", "is", null).returningAll().executeTakeFirst();
		return row ? dto(row) : null;
	}

	static async appeal(db: Kysely<Database>, id: string, by: string, message: string) {
		const existing = await db.selectFrom("sanction").select(["evidence"]).where("id", "=", id).executeTakeFirst();
		if (!existing) return null;
		const evidence = [...(existing.evidence ?? []), { type: "appeal", message, by, at: new Date().toISOString() }];
		const row = await db.updateTable("sanction").set({ evidence, updated_at: new Date() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
		return dto(row);
	}
}
