import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { resolveAchilleaSession } from "../../auth/session";
import { SanctionModel } from "./model";
import { SanctionService } from "./service";

async function session(headers: { authorization?: string; cookie?: string }) { return resolveAchilleaSession(headers); }

export const sanctionController = new Elysia({ prefix: "/sanctions" })
	.use(dbPlugin)
	.get("/", async ({ db, headers, query }) => {
		if (!await session(headers)) return status(401, { message: "Authentication required" as const });
		return SanctionService.list(db, query);
	}, {
		query: t.Object({ userId: t.Optional(t.String()), guildId: t.Optional(t.String()), type: t.Optional(t.String()), active: t.Optional(t.BooleanString()), page: t.Optional(t.Numeric()), pageSize: t.Optional(t.Numeric()) }),
		response: { 200: SanctionModel.list, 401: SanctionModel.unauthorized },
	})
	.post("/", async ({ db, headers, body, set }) => {
		const actor = await session(headers);
		if (!actor) return status(401, { message: "Authentication required" as const });
		const user = await db.selectFrom("user").select("role").where("id", "=", actor.id).executeTakeFirst();
		if (!user || user.role < 2) return status(403, { message: "Administrator role required" as const });
		set.status = 201;
		return SanctionService.create(db, { ...body, issuedBy: actor.id });
	}, {
		body: t.Object({ userId: t.String(), guildId: t.String(), type: t.String(), reason: t.Optional(t.Nullable(t.String())), durationSec: t.Optional(t.Nullable(t.Numeric())), evidence: t.Optional(t.Nullable(t.Array(t.Record(t.String(), t.Any())))) }),
		response: { 201: SanctionModel.sanction, 401: SanctionModel.unauthorized, 403: t.Object({ message: t.Literal("Administrator role required") }) },
	})
	.post("/:id/revoke", async ({ db, headers, params: { id }, body }) => {
		const actor = await session(headers);
		if (!actor) return status(401, { message: "Authentication required" as const });
		const user = await db.selectFrom("user").select("role").where("id", "=", actor.id).executeTakeFirst();
		if (!user || user.role < 2) return status(403, { message: "Administrator role required" as const });
		const row = await SanctionService.revoke(db, id, actor.id, body.reason);
		return row ? row : status(404, { message: "Sanction not found" as const });
	}, { params: t.Object({ id: t.String() }), body: t.Object({ reason: t.Optional(t.String()) }), response: { 200: SanctionModel.sanction, 401: SanctionModel.unauthorized, 403: t.Object({ message: t.Literal("Administrator role required") }), 404: t.Object({ message: t.Literal("Sanction not found") }) } })
	.post("/:id/appeal", async ({ db, headers, params: { id }, body }) => {
		const actor = await session(headers);
		if (!actor) return status(401, { message: "Authentication required" as const });
		const [sanction, user] = await Promise.all([
			db.selectFrom("sanction").select("user_id").where("id", "=", id).executeTakeFirst(),
			db.selectFrom("user").select("role").where("id", "=", actor.id).executeTakeFirst(),
		]);
		if (!sanction) return status(404, { message: "Sanction not found" as const });
		if (sanction.user_id !== actor.id && (user?.role ?? 0) < 2) return status(403, { message: "Sanction ownership required" as const });
		const row = await SanctionService.appeal(db, id, actor.id, body.message.trim());
		return row ? row : status(404, { message: "Sanction not found" as const });
	}, { params: t.Object({ id: t.String() }), body: t.Object({ message: t.String({ minLength: 3 }) }), response: { 200: SanctionModel.sanction, 401: SanctionModel.unauthorized, 403: t.Object({ message: t.Literal("Sanction ownership required") }), 404: t.Object({ message: t.Literal("Sanction not found") }) } });
