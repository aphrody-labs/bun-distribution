"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { isPatreonAdmin } from "@/lib/patreon/admin-access";
import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import { createPostgresClient } from "@rosegriffon/db/service";

/**
 * Récupère la session Better Auth côté serveur (avec cache React par requête).
 */
export const getServerSession = cache(async () =>
	auth.api.getSession({ headers: await headers() })
);

/**
 * Récupère l'utilisateur authentifié ou null.
 */
export const getServerUser = cache(async () => {
	const session = await getServerSession();
	return session?.user ?? null;
});

/**
 * Assure l'authentification — redirige vers /login si non connecté.
 */
export async function requireAuth() {
	const user = await getServerUser();
	if (!user) {
		redirect("/login");
	}
	return user;
}

/**
 * Assure l'authentification admin — redirige si non admin/staff.
 */
export async function requireAdmin() {
	const user = await requireAuth();
	const supabase = createPostgresClient();
	const profile = await resolveProfile(supabase, user);

	if (!profile || !isAdmin(profile.role)) {
		console.warn("[requireAdmin] denied", {
			resolvedRole: profile?.role,
			userId: user.id,
		});
		redirect("/dashboard");
	}

	return { role: profile.role, user };
}

/**
 * Garde stricte pour la zone d'administration Patreon.
 */
export async function requirePatreonCreator() {
	const user = await requireAuth();
	const allowed = await isPatreonAdmin(user);
	if (!allowed) {
		console.warn("[requirePatreonCreator] denied", {
			email: user.email,
			userId: user.id,
		});
		redirect("/dashboard");
	}
	return user;
}

/**
 * Require auth or fail with an error (for server actions).
 */
export async function requireAuthOrFail() {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non autorisé");
	}
	return session;
}

/**
 * Same as requireAdmin but throws instead of redirecting.
 */
export async function requireAdminOrFail() {
	const user = await getServerUser();
	if (!user) {
		throw new Error("Non autorisé");
	}

	const supabase = createPostgresClient();
	const profile = await resolveProfile(supabase, user);

	if (!profile || !isAdmin(profile.role)) {
		throw new Error("Accès réservé aux administrateurs");
	}

	return { profile, session: { user } };
}

/**
 * True if the user with the given Discord ID owns the Médaille Azalée role.
 */
export async function hasMedailleAzaleeRole(
	discordId: string | null | undefined
): Promise<boolean> {
	if (!discordId) {
		return false;
	}
	const db = createPostgresClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = (await (db as any)
		.from("discord_members")
		.select("roles")
		.eq("discord_id", discordId)
		.single()) as { data: { roles: unknown } | null };

	if (!data?.roles) {
		return false;
	}

	const roles = Array.isArray(data.roles)
		? (data.roles as string[])
		: (() => {
				try {
					return JSON.parse(String(data.roles)) as string[];
				} catch {
					return [];
				}
			})();

	return roles.includes("1269389408465059952");
}

/**
 * Editor-tier guard: ADMIN_ROLES or Médaille Azalée members.
 */
export async function requireEditorOrFail() {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non autorisé");
	}

	const supabase = createPostgresClient();
	const profile = await resolveProfile(supabase, session.user);

	if (!profile) {
		throw new Error("Profil introuvable");
	}

	if (isAdmin(profile.role)) {
		return {
			isAdmin: true as const,
			isMedaille: false as const,
			profile,
			session,
		};
	}

	if (await hasMedailleAzaleeRole(profile.discord_id)) {
		return {
			isAdmin: false as const,
			isMedaille: true as const,
			profile,
			session,
		};
	}

	throw new Error("Accès réservé à l'équipe rédactionnelle");
}
