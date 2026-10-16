"use server";

import { resolveProfile, isAdmin } from "@rosegriffon/auth";
import { createPostgresClient } from "@rosegriffon/db/service";
import { getServerUser } from "@/lib/auth-helpers";

export async function logAdminAction(
	action: string,
	targetType: string,
	targetId?: string,
	details?: Record<string, unknown> | null
) {
	try {
		const user = await getServerUser();
		if (!user) {
			return;
		}

		const admin = createPostgresClient();

		// Vérifier les permissions admin/staff
		const profile = await resolveProfile(admin, user);
		if (!profile || !isAdmin(profile.role)) {
			console.warn("[logAdminAction] Tentative non autorisée d'écriture de log par", user.id);
			return;
		}

		await admin.from("admin_audit_log").insert({
			action,
			details: details as unknown as Record<string, unknown>,
			entity_id: targetId,
			entity_type: targetType,
			user_id: user.id,
		});
	} catch (error) {
		console.error("Failed to log admin action:", error);
	}
}
