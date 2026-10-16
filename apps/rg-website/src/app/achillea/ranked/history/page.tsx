import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import RankedHistoryClient from "./ranked-history-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `ranked-history-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Historique des matchs classés",
	description:
		"Résultats classés Achilléa, scores et variations de points match après match.",
	chemin: "/achillea/ranked/history",
	indexable: false,
});

export default async function RankedHistoryPage({ searchParams }: { searchParams: Promise<{ player?: string; mode?: string; period?: string; result?: string }> }) {
	const { player, mode, period, result } = await searchParams;
	return <RankedHistoryClient playerId={player || undefined} initialMode={mode === "2" || mode === "4" ? Number(mode) as 2 | 4 : -1} initialPeriod={period === "7" || period === "30" ? Number(period) : 0} initialResult={result === "win" || result === "loss" || result === "draw" || result === "forfeit" ? result : "all"} />;
}
