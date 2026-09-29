import { GamePageLayout } from "@/components/GamePageLayout";
import { PfcGame } from "./PfcGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Pierre-Feuille-Ciseaux Dragon Ball — Jeux",
	description:
		"Affronte le bot au pierre-feuille-ciseaux version Dragon Ball et grimpe au classement.",
	alternates: { canonical: "/jeux/pfc" },
};

export const dynamic = "force-dynamic";

export default function PfcPlayPage() {
	return (
		<GamePageLayout
			path="/jeux/pfc"
			title="Pierre · Feuille · Ciseaux"
			maxWidth="max-w-2xl"
			subtitle={(u) => `${u} ❯ VS BOT ❯ MÊMES RÈGLES /pfc`}
		>
			<PfcGame />
		</GamePageLayout>
	);
}
