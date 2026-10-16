import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { normalizeNames } from "@rosegriffon/achillea-core";

export abstract class OrganizationService {
	private static baseQuery(db: Kysely<Database>) {
		return db.selectFrom("organization as organization")
			.selectAll("organization")
			.select((eb) => [
				jsonObjectFrom(eb.selectFrom("user as owner").select([
					"owner.id", "owner.username", "owner.display_name as displayName", "owner.avatar",
				]).whereRef("owner.id", "=", "organization.owner_id")).as("owner"),
				jsonArrayFrom(eb.selectFrom("organization_manager as manager")
					.innerJoin("user as managerUser", "managerUser.id", "manager.user_id")
					.select([
						"managerUser.id", "managerUser.username",
						"managerUser.display_name as displayName", "managerUser.avatar",
					])
					.whereRef("manager.organization_id", "=", "organization.id")
					.orderBy("manager.created_at", "asc")).as("managers"),
			]);
	}

	public static async findAll(db: Kysely<Database>, page = 1, pageSize = 50, state = 1) {
		const offset = Math.max(0, page - 1) * Math.min(50, Math.max(1, pageSize));
		const limit = Math.min(50, Math.max(1, pageSize));
		const rows = await this.baseQuery(db).where("organization.state", "=", state)
			.orderBy("organization.created_at", "asc").limit(limit).offset(offset).execute();
		const count = await db.selectFrom("organization").select(({ fn }) => fn.countAll<number>().as("count"))
			.where("state", "=", state).executeTakeFirst();
		return { data: rows.map(toDTO), count: Number(count?.count ?? 0) };
	}

	public static async findById(db: Kysely<Database>, id: number) {
		const row = await this.baseQuery(db).where("organization.id", "=", id).executeTakeFirst();
		return row ? toDTO(row) : null;
	}

	public static async mine(db: Kysely<Database>, userId: string) {
		const managed = await db.selectFrom("organization_manager").select("organization_id").where("user_id", "=", userId).execute();
		const ids = managed.map((row) => row.organization_id);
		let query = this.baseQuery(db).where("organization.owner_id", "=", userId);
		if (ids.length) query = query.unionAll(this.baseQuery(db).where("organization.id", "in", ids)) as typeof query;
		return (await query.execute()).map(toDTO);
	}

	public static async create(db: Kysely<Database>, input: {
		ownerId: string; name: string; normalizedName: string; logo: string; description: string;
		origin: string; orgManagerIds: string[]; socialMedias?: Array<{ platform?: string; canonicalUrl?: string }>;
		broadcastMedias?: Array<{ platform?: string; canonicalUrl?: string }>;
	}) {
		const normalizedName = normalizeNames(input.name);
		if (normalizedName.toLowerCase() !== input.normalizedName.trim().toLowerCase()) throw new Error("Normalized name does not match");
		if ([...input.name].length < 3 || [...input.name].length > 30) throw new Error("Invalid organization name");
		const duplicate = await db.selectFrom("organization").select("id").where("normalized_name", "=", normalizedName).executeTakeFirst();
		if (duplicate) throw new Error("Organization name already taken");
		const links = [...(input.socialMedias ?? []), ...(input.broadcastMedias ?? [])];
		const link = (platform: string) => links.find((item) => item.platform?.toLowerCase() === platform)?.canonicalUrl ?? null;
		return db.transaction().execute(async (trx) => {
			const row = await trx.insertInto("organization").values({
				name: input.name, normalized_name: normalizedName, logo: input.logo, description: input.description,
				owner_id: input.ownerId, state: 0, preapproved: false, preapproved_at: null, preapproved_by: null,
				origin: input.origin, twitter_url: link("x") ?? link("twitter"), instagram_url: link("instagram"),
				tiktok_url: link("tiktok"), twitch_url: link("twitch"), youtube_url: link("youtube"),
			}).returning("id").executeTakeFirstOrThrow();
			const managerIds = [...new Set(input.orgManagerIds.filter((id) => id !== input.ownerId))];
			if (managerIds.length) await trx.insertInto("organization_manager").values(managerIds.map((userId) => ({ organization_id: row.id, user_id: userId }))).execute();
			return row.id;
		}).then((id) => this.findById(db, id));
	}

	public static async setState(db: Kysely<Database>, id: number, state: number) {
		const updated = await db.updateTable("organization").set({ state, updated_at: new Date() }).where("id", "=", id).executeTakeFirst();
		if (!Number(updated.numUpdatedRows)) return null;
		return this.findById(db, id);
	}
}

function toDTO(row: any) {
	return {
		id: row.id, name: row.name, normalizedName: row.normalized_name, logo: row.logo,
		description: row.description, state: row.state, preapproved: Boolean(row.preapproved), origin: row.origin,
		createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
		owner: row.owner ?? null, managers: row.managers ?? [],
	};
}
