import { Elysia, status, t } from "elysia";
import { sql } from "kysely";
import { dbPlugin } from "../../../plugins/db";

type GuildRow = Record<string, unknown> & { id: string };
type StatsRow = { total_guilds: number; total_members: string; last_scan: string | null };

/** Public Discord scan projections stored in the shared Achillea schema. */
export const guildsController = new Elysia({ prefix: "/guilds" })
	.use(dbPlugin)
	.get("/", async ({ db, query }) => {
		const page = query.page ?? 1;
		const limit = query.limit ?? 25;
		const offset = (page - 1) * limit;
		const [guilds, count] = await Promise.all([
			sql<GuildRow>`SELECT id, name, icon, banner, owner_id, member_count, presence_count,
				features, premium_tier, verification_level, description, scanned_at
				FROM "guild" WHERE name IS NOT NULL
				ORDER BY member_count DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`.execute(db),
			sql<{ total: number }>`SELECT COUNT(*)::int AS total FROM "guild" WHERE name IS NOT NULL`.execute(db),
		]);
		const total = count.rows[0]?.total ?? 0;
		return { data: guilds.rows, meta: { page, limit, total, pageCount: Math.ceil(total / limit) } };
	}, {
		query: t.Object({
			page: t.Optional(t.Numeric({ minimum: 1 })),
			limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
		}),
	})
	.get("/stats", async ({ db }) => {
		const [aggregate, tiers, channelTypes] = await Promise.all([
			sql<StatsRow>`SELECT COUNT(*)::int AS total_guilds,
				COALESCE(SUM(member_count), 0)::bigint AS total_members,
				MAX(scanned_at) AS last_scan
				FROM "guild" WHERE name IS NOT NULL`.execute(db),
			sql<{ premium_tier: number | null; count: number }>`SELECT premium_tier, COUNT(*)::int AS count
				FROM "guild" WHERE name IS NOT NULL
				GROUP BY premium_tier ORDER BY premium_tier`.execute(db),
			sql<{ type: number; count: number }>`SELECT type, COUNT(*)::int AS count
				FROM "guild_channel" GROUP BY type ORDER BY type`.execute(db),
		]);
		const row = aggregate.rows[0];
		return {
			total_guilds: row?.total_guilds ?? 0,
			total_members: Number(row?.total_members ?? 0),
			last_scan: row?.last_scan ?? null,
			by_premium_tier: tiers.rows,
			by_channel_type: channelTypes.rows,
		};
	})
	.get("/:id", async ({ db, params }) => {
		const id = params.id;
		const guild = await sql<GuildRow>`SELECT id, name, icon, banner, owner_id, member_count, presence_count,
			features, premium_tier, verification_level, description, scanned_at
			FROM "guild" WHERE id = ${id}`.execute(db);
		const row = guild.rows[0];
		if (!row) return status(404, { message: "Guild not found" as const });
		const [roles, channels] = await Promise.all([
			sql<Record<string, unknown>>`SELECT id, name, color, position, permissions, hoist, managed, mentionable
				FROM "guild_role" WHERE guild_id = ${id} ORDER BY position DESC`.execute(db),
			sql<Record<string, unknown>>`SELECT id, name, type, parent_id, position, topic, nsfw
				FROM "guild_channel" WHERE guild_id = ${id} ORDER BY position ASC`.execute(db),
		]);
		return { ...row, roles: roles.rows, channels: channels.rows };
	}, { params: t.Object({ id: t.String({ pattern: "^\\d{15,25}$" }) }) });
