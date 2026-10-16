"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { badgeMerite, filtrerBadges, SchemaProfilPublic } from "@rosegriffon/types/profil";
import { isAdminRole } from "@rosegriffon/types/roles";
import { createPostgresClient } from "@rosegriffon/db/service";

import { getServerUser } from "@/lib/auth-helpers";
import { PUBLIC_PROFILE_COLUMNS, type PublicProfile } from "@rosegriffon/db/profiles";

/**
 * Actions du compte.
 *
 * Toutes écrivent en **service-role** après vérification de session : depuis la
 * fermeture PII des `profiles` (11/8/2026), la table n'est plus accessible en
 * `anon` et un client anonyme échouerait en 42501.
 *
 * Chaque action ne met à jour QUE ses propres colonnes. La version précédente
 * demandait à chaque formulaire de réinjecter les champs des autres onglets
 * pour « les préserver » : dès que la lecture initiale était partielle, la
 * sauvegarde d'une adresse écrasait le pseudo et la bio par des chaînes vides.
 */

const addressSchema = z.object({
	address_line1: z.string().optional(),
	address_line2: z.string().optional(),
	city: z.string().optional(),
	country: z.string().optional(),
	postal_code: z.string().optional(),
});

/** Lecture canonique du profil courant pour les composants client. */
export async function getCurrentPublicProfile(): Promise<PublicProfile | null> {
	const user = await getServerUser();
	if (!user) return null;
	const db = createPostgresClient();
	const { data: direct } = await db
		.from("profiles")
		.select(PUBLIC_PROFILE_COLUMNS)
		.eq("id", user.id)
		.maybeSingle();
	return (direct as PublicProfile | null) ?? null;
}

function firstIssue(error: z.ZodError): string {
	return error.issues[0]?.message ?? "Données invalides.";
}

export async function updateProfile(
	// `z.input` et non `z.infer` : le formulaire partagé envoie des `string[]`,
	// c'est la validation qui les restreint aux badges connus. Prendre le type
	// de SORTIE ferait refuser l'appel au compilateur alors que la valeur est
	// exactement celle attendue.
	values: z.input<typeof SchemaProfilPublic>
): Promise<{ error?: string }> {
	const user = await getServerUser();
	if (!user) {
		return { error: "Session expirée — reconnecte-toi." };
	}

	const parsed = SchemaProfilPublic.safeParse(values);
	if (!parsed.success) {
		return { error: firstIssue(parsed.error) };
	}

	const admin = createPostgresClient();
	const badges = await badgesAutorises(user.id, parsed.data.badges);

	const { data: updated, error } = await admin
		.from("profiles")
		.update({ ...parsed.data, badges, updated_at: new Date().toISOString() })
		.eq("id", user.id)
		.select("id")
		.maybeSingle();

	if (error) {
		if (error.code === "23505") {
			return { error: "Ce nom d'utilisateur est déjà pris." };
		}
		console.error("[compte] mise à jour du profil impossible", error);
		return { error: "Erreur lors de la mise à jour du profil." };
	}
	if (!updated) return { error: "Profil introuvable. Reconnecte-toi avant de réessayer." };

	revalidatePath("/settings");
	revalidatePath(`/profil/${parsed.data.username}`);
	return {};
}

/**
 * Ne garde que les badges auxquels le compte a droit.
 *
 * La règle est dans `@rosegriffon/types/profil` (partagée avec Azalée) ; ici on
 * ne fait que lui apporter ce que la base sait : le rôle du compte, son
 * mécénat, et les badges déjà posés.
 */
async function badgesAutorises(userId: string, demandes: string[]): Promise<string[]> {
	if (!demandes.some((badge) => badgeMerite(badge))) {
		return [...demandes];
	}

	const admin = createPostgresClient();
	const [{ data: profil }, { data: mecenat }] = await Promise.all([
		admin.from("profiles").select("role, badges").eq("id", userId).maybeSingle(),
		admin
			.from("patreon_memberships")
			.select("patron_status")
			.eq("user_id", userId)
			.eq("patron_status", "active_patron")
			.limit(1)
			.maybeSingle(),
	]);

	const ligne = profil as { role?: string | null; badges?: unknown } | null;
	return filtrerBadges(demandes, {
		dejaPoses: Array.isArray(ligne?.badges) ? (ligne.badges as string[]) : [],
		estMecene: Boolean(mecenat),
		estStaff: isAdminRole(ligne?.role ?? null),
	});
}

export async function updateAddress(
	values: z.infer<typeof addressSchema>
): Promise<{ error?: string }> {
	const user = await getServerUser();
	if (!user) {
		return { error: "Session expirée — reconnecte-toi." };
	}

	const parsed = addressSchema.safeParse(values);
	if (!parsed.success) {
		return { error: firstIssue(parsed.error) };
	}

	const { data: updated, error } = await createPostgresClient()
		.from("profiles")
		.update({ ...parsed.data, updated_at: new Date().toISOString() })
		.eq("id", user.id)
		.select("id")
		.maybeSingle();

	if (error) {
		console.error("[compte] mise à jour de l'adresse impossible", error);
		return { error: "Erreur lors de l'enregistrement de l'adresse." };
	}
	if (!updated) return { error: "Profil introuvable. Reconnecte-toi avant de réessayer." };

	revalidatePath("/settings");
	return {};
}

/**
 * Enregistre l'URL d'avatar déjà téléversée.
 *
 * L'identifiant vient de la session, jamais du client : la signature
 * précédente prenait un `userId` en paramètre, ce qui laissait n'importe quel
 * appelant réécrire l'avatar d'un autre compte.
 */
export async function updateAvatarUrl(avatarUrl: string): Promise<{ error?: string }> {
	const user = await getServerUser();
	if (!user) {
		return { error: "Session expirée — reconnecte-toi." };
	}

	const admin = createPostgresClient();
	const { data: updated, error } = await admin
		.from("profiles")
		.update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
		.eq("id", user.id)
		.select("username")
		.maybeSingle();

	if (error) {
		console.error("[compte] mise à jour de l'avatar impossible", error);
		return { error: "Impossible d'enregistrer le nouvel avatar." };
	}
	if (!updated) return { error: "Profil introuvable. Reconnecte-toi avant de réessayer." };

	revalidatePath("/settings");
	const username = updated.username;
	if (username) {
		revalidatePath(`/profil/${username}`);
	}
	return {};
}
