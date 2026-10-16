import { NextResponse } from "next/server";
import {
	lireClassement,
	lireChiffresEsport,
	lireClansActifs,
	lireTournoisActifs,
	type LigneClassement,
	type ChiffresEsport,
	type PreviewClan,
	type PreviewTournament,
} from "@/lib/achillea/classement";

export const dynamic = "force-dynamic";

export type { PreviewClan, PreviewTournament };

export interface AchilleaPreviewData {
	leaderboard: LigneClassement[];
	clans: PreviewClan[];
	tournaments: PreviewTournament[];
	stats: ChiffresEsport;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const type = searchParams.get("type"); // "leaderboard" | "clans" | "tournaments" | "stats" | null

	try {
		const [leaderboard, stats, clans, tournaments] = await Promise.all([
			lireClassement(2, 4),
			lireChiffresEsport(),
			lireClansActifs(4),
			lireTournoisActifs(4),
		]);

		const result: AchilleaPreviewData = {
			clans,
			leaderboard,
			stats,
			tournaments,
		};

		if (type && type in result) {
			return NextResponse.json(
				{ [type]: result[type as keyof AchilleaPreviewData] },
				{ headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
			);
		}

		return NextResponse.json(result, {
			headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
		});
	} catch (error) {
		console.error("Erreur API achillea/preview:", error);
		return NextResponse.json(
			{
				clans: [],
				leaderboard: [],
				stats: { clans: 0, joueurs: 0, partiesClassees: 0 },
				tournaments: [],
			},
			{ status: 200 }
		);
	}
}
