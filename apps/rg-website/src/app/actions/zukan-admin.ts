"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";

export async function updateZukanHash(
	characterId: string,
	newHash: string | null
): Promise<{ success: boolean; error?: string }> {
	try {
		await requireAdmin();

		const supabase = createPostgresClient();
		const { error } = await supabase
			.from("inagle_characters")
			.update({ zukan_hash: newHash })
			.eq("id", characterId);

		if (error) {
			return { error: error.message, success: false };
		}

		revalidatePath("/dashboard/zukan-review");
		return { success: true };
	} catch {
		return { error: "Accès non autorisé ou erreur serveur.", success: false };
	}
}
