import type { Metadata } from "next";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import CastAvailabilityClient from "./cast-availability-client";

/*
 * Page serveur : elle n'existe que pour porter les métadonnées, que
 * `"use client"` interdit. L'interface, inchangée, vit dans
 * `cast-availability-client.tsx`.
 *
 * Non indexable : la page déclare les créneaux D'UN caster identifié, elle n'a
 * pas de version publique.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	return metadonneesAchillea({
		titre: "Mes disponibilités en régie",
		description: "Déclaration des créneaux de disponibilité pour un évènement Achilléa.",
		chemin: `/achillea/casts/${id}/availability`,
		indexable: false,
	});
}

export default async function CastAvailabilityPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <CastAvailabilityClient id={id} />;
}
