import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import LicenceVerifyClient from "./licence-verify-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `licence-verify-client.tsx`.
 *
 * `chemin: null` DÉLIBÉRÉMENT : le segment d'URL est le secret imprimé sur le
 * QR de la licence. Un canonical le recopierait dans le `<head>`, donc dans
 * tout ce qui archive ou partage la page. `indexable: false` pour la même
 * raison — aucune de ces URL ne doit finir dans un index.
 */
export const metadata = metadonneesAchillea({
	titre: "Vérification de licence",
	description: "Contrôle de validité d'une licence compétiteur Achilléa.",
	chemin: null,
	indexable: false,
});

export default async function LicenceVerifyPage({
	params,
}: {
	params: Promise<{ qr: string }>;
}) {
	const { qr } = await params;
	return <LicenceVerifyClient qr={qr} />;
}
