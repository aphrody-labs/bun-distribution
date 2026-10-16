"use server";

/**
 * Appliquer l'avatar composé dans l'éditeur comme photo du compte.
 *
 * Le mécanisme de photo de profil existait déjà (téléversement dans le seau `avatars`, puis
 * écriture de `profiles.avatar_url`) : cette action s'y branche au lieu d'en ouvrir un second
 * chemin. Deux différences avec le téléversement depuis les réglages — l'image ne vient pas du
 * poste de l'utilisateur mais du CDN du jeu, et elle est donc récupérée **côté serveur**.
 *
 * L'identité vient de la session, jamais d'un paramètre : sans cela, n'importe quel appelant
 * réécrirait la photo d'un autre compte.
 */

import { revalidatePath } from "next/cache";
import { cdnOrigin } from "@rosegriffon/assets";

import { getServerSession } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";
import {
	enregistrerDansDepot,
	listerDansDepot,
	ouvrirDansDepot,
	supprimerDansDepot,
} from "./sauvegardes";
import type {
	AvatarEnregistre,
	DepotSauvegardes,
	LigneSauvegarde,
	Sauvegarde,
} from "./sauvegardes";

export type { AvatarEnregistre, Sauvegarde } from "./sauvegardes";

/** Origine qui sert les vignettes décodées du jeu. */
const CDN = cdnOrigin(process.env.NEXT_PUBLIC_CDN_ORIGIN);

/** Seau de stockage des photos de profil, celui des réglages du compte. */
const SEAU = "avatars";

/** Plafond de taille de la vignette récupérée — une icône du jeu pèse quelques kilo-octets. */
const TAILLE_MAX = 2 * 1024 * 1024;

/**
 * Nom d'icône du jeu : lettres, chiffres et soulignés uniquement.
 *
 * La valeur part dans une URL ; sans ce filtre, un nom fabriqué ferait sortir la requête du
 * chemin des vignettes.
 */
const NOM_VALIDE = /^[A-Za-z0-9_]{3,64}$/;

/**
 * Pose la vignette `icone` (une image du jeu) comme photo du compte connecté.
 *
 * @param icone nom d'icône tel que le catalogue le fournit, p. ex. `icon_ava_face05_001`.
 * @returns l'URL publique enregistrée, ou un message d'erreur affichable.
 */
export async function definirPhotoDepuisAvatar(
	icone: string
): Promise<{ url?: string; error?: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Connecte-toi pour utiliser cet avatar comme photo de profil." };
	}
	if (!NOM_VALIDE.test(icone)) {
		return { error: "Vignette inconnue." };
	}

	let octets: ArrayBuffer;
	try {
		// La vignette est un fichier du jeu : elle ne change pas. `no-store` faisait re-décoder
		// l'atlas au serveur d'assets à chaque clic, pour un résultat identique.
		const reponse = await fetch(`${CDN}/avatar/icon/${icone}.png`, { cache: "force-cache" });
		if (!reponse.ok) {
			return { error: "Cette vignette n'a pas pu être récupérée." };
		}
		octets = await reponse.arrayBuffer();
	} catch {
		return { error: "Le service d'images du jeu est injoignable." };
	}
	if (octets.byteLength === 0 || octets.byteLength > TAILLE_MAX) {
		return { error: "Cette vignette n'a pas pu être récupérée." };
	}

	const admin = createPostgresClient();
	// Chemin daté, comme le téléversement des réglages : un chemin fixe resservirait l'ancienne
	// image depuis le cache du CDN et du navigateur.
	const chemin = `${session.user.id}/avatar-${Date.now()}.png`;
	const { error: erreurEnvoi } = await admin.storage
		.from(SEAU)
		.upload(chemin, octets, { contentType: "image/png", upsert: true });
	if (erreurEnvoi) {
		console.error("[avatar] téléversement impossible", erreurEnvoi);
		return { error: "Impossible d'enregistrer cette photo." };
	}

	const {
		data: { publicUrl },
	} = admin.storage.from(SEAU).getPublicUrl(chemin);

	const { error: erreurProfil } = await admin
		.from("profiles")
		.update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
		.eq("id", session.user.id);
	if (erreurProfil) {
		console.error("[avatar] écriture du profil impossible", erreurProfil);
		return { error: "Impossible d'enregistrer cette photo." };
	}

	revalidatePath("/settings");
	revalidatePath("/avatar");
	return { url: publicUrl };
}

// ─── Sauvegarde et partage ────────────────────────────────────────────────────

function creerDepot(): DepotSauvegardes {
	const admin = createPostgresClient();
	return {
		async compter(userId) {
			const { count } = await admin
				.from("avatar_saves")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId);
			return count ?? 0;
		},
		async inserer({ userId, nom, donnees, code }) {
			const { data, error } = await admin
				.from("avatar_saves")
				.insert({ user_id: userId, nom, donnees, code })
				.select("id")
				.single();
			return { id: data?.id as string | undefined, error: error ?? undefined };
		},
		async lister(userId, limite) {
			const { data, error } = await admin
				.from("avatar_saves")
				.select("id, user_id, nom, code, donnees, modifie_le")
				.eq("user_id", userId)
				.order("modifie_le", { ascending: false })
				.limit(limite);
			const lignes = (data ?? []).map((r: {
				id: string;
				user_id: string;
				nom: string;
				code: string;
				donnees: unknown;
				modifie_le: string;
			}) => ({
				id: r.id,
				userId: r.user_id,
				nom: r.nom,
				code: r.code,
				donnees: r.donnees as AvatarEnregistre,
				modifieLe: r.modifie_le,
			})) as LigneSauvegarde[];
			return { lignes, error: error ?? undefined };
		},
		async trouverParCode(code) {
			const { data, error } = await admin
				.from("avatar_saves")
				.select("id, user_id, nom, code, donnees, modifie_le")
				.eq("code", code)
				.maybeSingle();
			const ligne = data
				? {
						id: data.id,
						userId: data.user_id,
						nom: data.nom,
						code: data.code,
						donnees: data.donnees as AvatarEnregistre,
						modifieLe: data.modifie_le,
					}
				: null;
			return { ligne, error: error ?? undefined };
		},
		async supprimer(userId, id) {
			const { error } = await admin
				.from("avatar_saves")
				.delete()
				.eq("id", id)
				.eq("user_id", userId);
			return { error: error ?? undefined };
		},
	};
}

/**
 * Enregistre l'avatar courant sous le compte connecté.
 *
 * `code` est le code de partage produit par l'éditeur. La table reste entièrement privée sous
 * RLS ; seule `ouvrirParCode`, après validation, effectue la lecture privilégiée côté serveur.
 */
export async function enregistrerAvatar(
	nom: string,
	donnees: AvatarEnregistre,
	code: string | null
): Promise<{ id?: string; error?: string }> {
	const resultat = await enregistrerDansDepot(
		creerDepot(),
		(await getServerSession())?.user?.id,
		nom,
		donnees,
		code
	);
	if (resultat.id) revalidatePath("/avatar");
	return resultat;
}

/** Les avatars enregistrés du compte connecté, du plus récent au plus ancien. */
export async function listerAvatars(): Promise<{ avatars?: Sauvegarde[]; error?: string }> {
	return listerDansDepot(creerDepot(), (await getServerSession())?.user?.id);
}

/**
 * Retrouve un avatar par son code de partage.
 *
 * Sert à ouvrir l'avatar de quelqu'un d'autre. Il n'existe aucune politique SELECT publique :
 * cette Server Action validée est l'unique passage vers le client de service.
 */
export async function ouvrirParCode(
	code: string
): Promise<{ avatar?: AvatarEnregistre; nom?: string; error?: string }> {
	return ouvrirDansDepot(creerDepot(), code);
}

/** Supprime une sauvegarde du compte connecté. */
export async function supprimerAvatar(id: string): Promise<{ error?: string }> {
	const resultat = await supprimerDansDepot(creerDepot(), (await getServerSession())?.user?.id, id);
	if (!resultat.error) revalidatePath("/avatar");
	return resultat;
}
