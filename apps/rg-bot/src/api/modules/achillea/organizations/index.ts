import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { OrganizationModel } from "./model";
import { OrganizationService } from "./service";
import { resolveAchilleaSession } from "../../auth/session";

const input = t.Object({
	name: t.String(), normalizedName: t.String(), logo: t.String(), description: t.String(),
	origin: t.String(),
	orgManagers: t.Optional(t.Array(t.Object({ id: t.String() }))),
	socialMedias: t.Optional(t.Array(t.Object({ platform: t.Optional(t.String()), canonicalUrl: t.Optional(t.String()) }))),
	broadcastMedias: t.Optional(t.Array(t.Object({ platform: t.Optional(t.String()), canonicalUrl: t.Optional(t.String()) }))),
});

async function session(headers: { authorization?: string; cookie?: string }) {
	return resolveAchilleaSession(headers);
}

export const organizationController = new Elysia({ prefix: "/organizations" })
	.use(dbPlugin)
	.get("/", async ({ db, headers, query }) => {
		// Approved organizations are public; pending/rejected review data is staff-only.
		if (query.state !== undefined && query.state !== 1) {
			const user = await session(headers);
			if (!user) return status(401, { message: "Authentication required" as const });
			const actor = await db.selectFrom("user").select("role").where("id", "=", user.id).executeTakeFirst();
			if (!actor || actor.role < 2) return status(403, { message: "Administrator role required" });
		}
		return OrganizationService.findAll(db, query.page, query.pageSize, query.state);
	}, {
		query: t.Object({
			page: t.Optional(t.Numeric({ minimum: 1 })), pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
			state: t.Optional(t.Numeric()),
		}),
		response: {
			200: OrganizationModel.listResponse,
			401: OrganizationModel.unauthorized,
			403: t.Object({ message: t.String() }),
		},
	})
	.get("/me", async ({ db, headers }) => {
		const user = await session(headers);
		if (!user) return status(401, { message: "Authentication required" as const });
		return { success: true, data: await OrganizationService.mine(db, user.id) };
	}, { response: { 200: t.Object({ success: t.Literal(true), data: t.Array(OrganizationModel.organization) }), 401: OrganizationModel.unauthorized } })
	.post("/create", async ({ db, headers, body }) => {
		const user = await session(headers);
		if (!user) return status(401, { message: "Authentication required" as const });
		try {
			const organization = await OrganizationService.create(db, { ...body, ownerId: user.id, orgManagerIds: (body.orgManagers ?? []).map((manager) => manager.id) });
			return { success: true, data: organization };
		} catch (error) {
			return status(400, { message: error instanceof Error ? error.message : "Invalid organization" });
		}
	}, { body: input, response: { 200: t.Object({ success: t.Literal(true), data: t.Nullable(OrganizationModel.organization) }), 400: t.Object({ message: t.String() }), 401: OrganizationModel.unauthorized } })
	.post("/validate", async ({ db, headers, body }) => {
		const user = await session(headers);
		if (!user) return status(401, { message: "Authentication required" as const });
		try {
			return { success: true, data: await OrganizationService.create(db, { ...body, ownerId: user.id, orgManagerIds: (body.orgManagers ?? []).map((manager) => manager.id) }) };
		} catch (error) {
			return status(400, { message: error instanceof Error ? error.message : "Invalid organization" });
		}
	}, { body: input, response: { 200: t.Object({ success: t.Literal(true), data: t.Nullable(OrganizationModel.organization) }), 400: t.Object({ message: t.String() }), 401: OrganizationModel.unauthorized } })
	.get("/:id", async ({ db, params: { id } }) => {
		const item = await OrganizationService.findById(db, id);
		return item ? item : status(404, { message: "Organization not found" as const });
	}, {
		params: t.Object({ id: t.Numeric() }),
		response: { 200: OrganizationModel.organization, 404: OrganizationModel.notFound },
	})
	.post("/:id/:action", async ({ db, headers, params: { id, action } }) => {
		const user = await session(headers);
		if (!user) return status(401, { message: "Authentication required" as const });
		const actor = await db.selectFrom("user").select("role").where("id", "=", user.id).executeTakeFirst();
		if (!actor || actor.role < 2) return status(403, { message: "Administrator role required" as const });
		if (action !== "approve" && action !== "reject") return status(404, { message: "Organization action not found" as const });
		const organization = await OrganizationService.setState(db, id, action === "approve" ? 1 : 2);
		return organization ? { success: true, data: organization } : status(404, { message: "Organization not found" as const });
	}, {
		params: t.Object({ id: t.Numeric(), action: t.String() }),
		response: { 200: t.Object({ success: t.Literal(true), data: t.Nullable(OrganizationModel.organization) }), 401: OrganizationModel.unauthorized, 403: t.Object({ message: t.String() }), 404: OrganizationModel.notFound },
	});
