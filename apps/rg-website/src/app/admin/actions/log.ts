"use server";

import { logAdminAction as log } from "@/lib/admin-logger";

export async function logAction(
	action: string,
	targetType: string,
	targetId?: string,
	details?: Record<string, unknown>
) {
	await log(action, targetType, targetId, details);
}
