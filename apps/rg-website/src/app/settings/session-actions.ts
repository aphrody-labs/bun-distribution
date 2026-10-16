"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { getServerSession } from "@/lib/auth-helpers";

/** Révoque une session du compte courant sans sérialiser son jeton au client. */
export async function revokeAccountSession(
	id: string,
): Promise<{ error?: string }> {
	const current = await getServerSession();
	if (!current?.user || !id || id.length > 128 || id === current.session.id) {
		return { error: "Session invalide ou expirée." };
	}

	try {
		const requestHeaders = await headers();
		const sessions = await auth.api.listSessions({ headers: requestHeaders });
		const target = sessions.find(
			(session) => session.id === id && session.userId === current.user.id,
		);
		if (!target) return { error: "Session introuvable." };

		const result = await auth.api.revokeSession({
			body: { token: target.token },
			headers: requestHeaders,
		});
		if (!result.status) return { error: "Révocation refusée." };
		return {};
	} catch {
		return { error: "Impossible de révoquer cette session." };
	}
}
