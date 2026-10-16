import type { Metadata } from "next";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import { createAchilleaClient } from "@/lib/achillea";
import { signalerEchec } from "@/lib/achillea/signaler";
import UserProfileClient from "./user-profile-client";

interface ProfilJoueurProps {
	params: Promise<{ id: string }>;
}

/*
 * Page serveur : elle n'existe que pour porter les métadonnées, que
 * `"use client"` interdit. L'interface, inchangée, vit dans
 * `user-profile-client.tsx`.
 *
 * Le pseudo affiché est celui que l'API sert publiquement (`GET /users/:id`) ;
 * aucune donnée de session n'est lue ici.
 */
export async function generateMetadata({ params }: ProfilJoueurProps): Promise<Metadata> {
	const { id } = await params;
	const chemin = `/achillea/users/${id}`;

	const resultat = await createAchilleaClient().users.get(id);
	if (!resultat.ok) {
		signalerEchec(`users/${id} — métadonnées`, resultat);
		return metadonneesAchillea({
			titre: "Profil joueur",
			description: "Palier, statistiques classées et palmarès d'un joueur Achilléa.",
			chemin,
		});
	}

	const joueur = resultat.value;
	const palier = joueur.soloRank?.key;
	return metadonneesAchillea({
		titre: joueur.username,
		description: palier
			? `${joueur.username} sur Achilléa : palier ${palier} (${joueur.soloRank?.elo ?? 0} AP) en 1v1, statistiques classées et palmarès en tournoi.`
			: `${joueur.username} sur Achilléa : statistiques classées, clan et palmarès en tournoi.`,
		chemin,
	});
}

export default async function UserProfilePage({ params }: ProfilJoueurProps) {
	const { id } = await params;
	return <UserProfileClient id={id} />;
}
