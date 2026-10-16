"use client";

import dynamic from "next/dynamic";

import type { SignupPoint } from "./signups-chart";

/**
 * Recharts ne descend qu'au moment où le graphe entre à l'écran.
 *
 * `signups-chart.tsx` importe `recharts` statiquement ; la page d'accueil de
 * l'administration l'importait elle aussi statiquement, si bien que toute la
 * bibliothèque partait dans le bundle de la route — pour une seule courbe
 * située sous la ligne de flottaison. Même motif que `ElementChartLoader`.
 */
const SignupsChart = dynamic(() => import("./signups-chart").then((m) => m.SignupsChart), {
	loading: () => (
		<div
			className="h-64 animate-pulse rounded-2xl bg-surface-container"
			aria-label="Chargement du graphique des inscriptions"
		/>
	),
	ssr: false,
});

export function SignupsChartLoader({ data }: { data: SignupPoint[] }) {
	return <SignupsChart data={data} />;
}
