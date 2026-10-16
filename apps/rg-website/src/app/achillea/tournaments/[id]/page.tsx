import type { Metadata } from "next";
import { metadonneesAchillea, resume } from "@/app/achillea/metadonnees";
import { createAchilleaClient, tournamentStateLabel } from "@/lib/achillea";
import { signalerEchec } from "@/lib/achillea/signaler";
import TournamentDetailClient from "./tournament-detail-client";

/*
 * Page serveur : elle n'existe que pour porter les métadonnées, que
 * `"use client"` interdit. L'interface, inchangée, vit dans
 * `tournament-detail-client.tsx`.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const numero = Number.parseInt(id, 10);
	const chemin = `/achillea/tournaments/${id}`;

	if (!Number.isFinite(numero)) {
		return metadonneesAchillea({
			titre: "Tournoi introuvable",
			description: "Ce tournoi Achilléa n'existe pas.",
			chemin: null,
			indexable: false,
		});
	}

	const resultat = await createAchilleaClient().tournaments.get(numero);
	if (!resultat.ok) {
		signalerEchec(`tournaments/${id} — métadonnées`, resultat);
		return metadonneesAchillea({
			titre: "Fiche de tournoi",
			description: "Format, inscrits et arbre de rencontres d'un tournoi Achilléa.",
			chemin,
		});
	}

	// `GET /tournaments/:id` répond un TRIPLET `[tournoi, inscrits, brackets]`.
	const [tournoi, inscrits] = resultat.value;
	return metadonneesAchillea({
		titre: tournoi.name,
		description:
			resume(tournoi.description) ??
			`${tournoi.name} — tournoi Inazuma Eleven: Victory Road sur Achilléa. ${tournamentStateLabel(tournoi.internalState)}, ${inscrits.length} inscrit(s).`,
		chemin,
	});
}

export default async function TournamentDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <TournamentDetailClient id={id} />;
}
