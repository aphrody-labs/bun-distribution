"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";

const EDITABLE_TABLES = new Set([
	"articles",
	"events",
	"inagle_characters",
	"inagle_items",
	"inagle_skills",
	"inagle_teams",
]);

const VERIFICATION_TABLES = new Set([
	"inagle_characters",
	"inagle_items",
	"inagle_skills",
	"inagle_teams",
]);

function validateId(id: string): string | null {
	return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

export async function updateGenericTable(
	table: string,
	id: string,
	payload: Record<string, unknown>
): Promise<{ error?: string }> {
	await requireAdmin();
	if (!EDITABLE_TABLES.has(table)) return { error: "Table non autorisée." };
	const validId = validateId(id);
	if (!validId) return { error: "Identifiant invalide." };
	const { error } = await createPostgresClient().from(table).update(payload).eq("id", validId);
	return error ? { error: error.message } : {};
}

export async function updateInagleTranslation(
	table: string,
	id: string,
	payload: Record<string, unknown>
): Promise<{ error?: string }> {
	await requireAdmin();
	if (!VERIFICATION_TABLES.has(table)) return { error: "Table non autorisée." };
	const validId = validateId(id);
	if (!validId) return { error: "Identifiant invalide." };
	const { error } = await createPostgresClient().from(table).update(payload).eq("id", validId);
	return error ? { error: error.message } : {};
}
