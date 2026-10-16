import type { Metadata } from "next";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import CastPlanningClient from "./cast-planning-client";

/*
 * Page serveur : elle n'existe que pour porter les métadonnées, que
 * `"use client"` interdit. L'interface, inchangée, vit dans
 * `cast-planning-client.tsx`.
 *
 * Non indexable : `GET /casts/events/:id` répond 401 sans session — un robot
 * n'y verrait qu'un planning vide.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	return metadonneesAchillea({
		titre: "Planning de régie",
		description: "Postes, attributions et checklist d'un évènement diffusé par la régie Achilléa.",
		chemin: `/achillea/casts/${id}/planning`,
		indexable: false,
	});
}

export default async function CastPlanningPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <CastPlanningClient id={id} />;
}
