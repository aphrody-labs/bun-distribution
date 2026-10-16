import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import RankedLeaderboardClient from "./ranked-leaderboard-client";
import { createAchilleaClient } from "@/lib/achillea";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `ranked-leaderboard-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Classement ELO",
	description:
		"Le classement des joueurs classés Achilléa en 1v1 et 2v2, recalculé à chaque match.",
	chemin: "/achillea/ranked/leaderboard",
	indexable: true,
});

export default async function RankedLeaderboardPage() {
	const result = await createAchilleaClient().ranked.leaderboard({ mode: 2, page: 0, pageSize: 25 });
	const tiers = await createAchilleaClient().ranked.tiers(2);
	return <RankedLeaderboardClient initialData={result.ok ? result.value : null} initialTiers={tiers.ok ? tiers.value : null} />;
}
