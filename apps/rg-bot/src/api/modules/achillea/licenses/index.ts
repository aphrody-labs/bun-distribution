import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { LicenseModel } from "./model";
import { LicenseService } from "./service";
import { resolveAchilleaSession } from "../../auth/session";

export const licenseController = new Elysia({ prefix: "/licenses" })
	.use(dbPlugin)
	.get("/me", async ({ db, headers }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		return LicenseService.findLatestForUser(db, session.id);
	}, {
		response: {
			200: LicenseModel.me,
			401: t.Object({ message: t.Literal("Authentication required") }),
		},
	})
	.get("/verify/:qrSecret", async ({ db, params: { qrSecret } }) => {
		if (qrSecret.length < 32 || qrSecret.length > 64) return status(200, { valid: false, reason: "not_found" as const });
		return LicenseService.verify(db, qrSecret);
	}, {
		params: t.Object({ qrSecret: t.String({ minLength: 1, maxLength: 128 }) }),
		response: { 200: LicenseModel.verify },
	});
