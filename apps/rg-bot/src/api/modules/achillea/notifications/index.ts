import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { resolveAchilleaSession } from "../../auth/session";

async function session(headers: { authorization?: string; cookie?: string }) {
	return resolveAchilleaSession(headers);
}

export const notificationsController = new Elysia({ prefix: "/notifications" })
	.use(dbPlugin)
	.get("/me", async ({ db, headers }) => {
		const identity = await session(headers);
		if (!identity) return status(401, { message: "Authentication required" as const });
		const rows = await db.selectFrom("user_notification as link")
			.innerJoin("notification", "notification.id", "link.notification_id")
			.select([
				"notification.id", "notification.created_at", "notification.updated_at",
				"notification.title", "notification.message", "notification.type",
				"notification.category", "notification.payload",
			])
			.where("link.user_id", "=", identity.id)
			.where("link.is_read", "=", false)
			.orderBy("notification.created_at", "desc")
			.execute();
		return { success: true as const, data: rows };
	}, { response: { 401: t.Object({ message: t.Literal("Authentication required") }) } })
	.patch("/read/:id", async ({ db, headers, params: { id } }) => {
		const identity = await session(headers);
		if (!identity) return status(401, { message: "Authentication required" as const });
		const updated = await db.updateTable("user_notification").set({ is_read: true, read_at: new Date(), updated_at: new Date() })
			.where("user_id", "=", identity.id).where("notification_id", "=", id).returning("id").executeTakeFirst();
		if (!updated) return status(404, { message: "Notification not found" as const });
		return { success: true as const };
	}, { params: t.Object({ id: t.Numeric() }) })
	.patch("/unread/:id", async ({ db, headers, params: { id } }) => {
		const identity = await session(headers);
		if (!identity) return status(401, { message: "Authentication required" as const });
		const updated = await db.updateTable("user_notification").set({ is_read: false, read_at: null, updated_at: new Date() })
			.where("user_id", "=", identity.id).where("notification_id", "=", id).returning("id").executeTakeFirst();
		if (!updated) return status(404, { message: "Notification not found" as const });
		return { success: true as const };
	}, { params: t.Object({ id: t.Numeric() }) })
	.patch("/read-all", async ({ db, headers }) => {
		const identity = await session(headers);
		if (!identity) return status(401, { message: "Authentication required" as const });
		await db.updateTable("user_notification").set({ is_read: true, read_at: new Date(), updated_at: new Date() })
			.where("user_id", "=", identity.id).where("is_read", "=", false).execute();
		return { success: true as const };
	}, { response: { 401: t.Object({ message: t.Literal("Authentication required") }) } });
