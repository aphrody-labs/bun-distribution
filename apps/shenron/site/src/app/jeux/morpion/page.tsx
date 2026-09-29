import { GamePageLayout } from "@/components/GamePageLayout";
import { MorpionGame } from "./MorpionGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Morpion Dragon Ball — Jeux",
	description: "Le morpion revisité Dragon Ball : aligne trois symboles avant ton adversaire.",
	alternates: { canonical: "/jeux/morpion" },
};

export const dynamic = "force-dynamic";

export default function MorpionPlayPage() {
	return (
		<GamePageLayout path="/jeux/morpion" title="Morpion" subtitle={(u) => `${u} (X) ❯ VS BOT (O)`}>
			<MorpionGame />
		</GamePageLayout>
	);
}
