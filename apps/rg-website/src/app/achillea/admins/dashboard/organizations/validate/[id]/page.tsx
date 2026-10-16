import type { Metadata } from "next";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import OrganizationValidationClient from "./organization-validation-client";

/*
 * Page serveur : elle n'existe que pour porter les métadonnées, que
 * `"use client"` interdit. L'interface, inchangée, vit dans
 * `organization-validation-client.tsx`.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	return metadonneesAchillea({
		titre: "Validation d'une organisation",
		description: "Instruction d'un dossier d'accréditation d'organisation esport.",
		chemin: `/achillea/admins/dashboard/organizations/validate/${id}`,
		indexable: false,
	});
}

export default async function OrganizationValidationPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <OrganizationValidationClient id={id} />;
}
