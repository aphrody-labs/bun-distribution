import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import WalletClient from "./wallet-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `wallet-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Mon portefeuille",
	description:
		"Solde d'Achilléa Points, historique des transactions et récompenses de tournoi.",
	chemin: "/achillea/wallet",
	indexable: false,
});

export default function WalletPage() {
	return <WalletClient />;
}
