import type { Metadata } from "next";
import { ogMeta } from "@/lib/og";

/**
 * Layout de `/ask` — sa seule raison d'être est de porter les métadonnées :
 * `page.tsx` est un composant client (`"use client"`), et un composant client ne
 * peut pas exporter `metadata`. La page n'avait donc AUCUN titre ni description
 * propres et héritait de ceux du site.
 */
export const metadata: Metadata = {
	title: "Assistant Dragon Ball",
	description:
		"Pose ta question sur l'univers Dragon Ball : l'assistant répond à partir du wiki et du manga, et cite ses sources. Personnages, sagas, techniques, films.",
	...ogMeta({
		title: "Assistant Dragon Ball — DBFR",
		description: "Une question sur Dragon Ball ? L'assistant répond en citant le wiki et le manga.",
		type: "website",
		canonical: "/ask",
	}),
};

export default function AskLayout({ children }: { children: React.ReactNode }) {
	return children;
}
