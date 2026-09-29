import { GamePageLayout } from "@/components/GamePageLayout";
import { BingoGame } from "./BingoGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Bingo du Ki — Jeux",
	description: "Devine la puissance de combat des guerriers Dragon Ball et marque tes cases.",
	alternates: { canonical: "/jeux/bingo" },
};

export const dynamic = "force-dynamic";

export default function BingoPlayPage() {
	return (
		<GamePageLayout
			path="/jeux/bingo"
			title="Bingo du Ki"
			subtitle={(u) => `${u} ❯ Devine 1-100 en 10 essais`}
		>
			<BingoGame />
		</GamePageLayout>
	);
}
