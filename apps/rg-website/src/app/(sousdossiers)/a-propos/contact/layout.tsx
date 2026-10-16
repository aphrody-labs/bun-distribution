import type { Metadata } from "next";

import { absoluteUrl } from "@/lib/site-url";

/**
 * La page de contact est un composant client (react-hook-form + TanStack
 * Query) : elle ne peut pas exporter `metadata`. Ce layout porte donc les
 * métadonnées de la route, sinon la page hérite du titre générique du layout
 * racine (« Rose Griffon | Association Inazuma Eleven France »).
 */
export const metadata: Metadata = {
	title: "Nous contacter · Rose Griffon",
	description:
		"Une question, une suggestion, un projet de collaboration ou une demande de presse ? Écrivez à l'association Rose Griffon via le formulaire de contact.",
	alternates: {
		canonical: absoluteUrl("/a-propos/contact"),
	},
	openGraph: {
		title: "Nous contacter · Rose Griffon",
		description:
			"Une question, une suggestion ou un projet de collaboration ? Écrivez à l'association Rose Griffon.",
		url: absoluteUrl("/a-propos/contact"),
		type: "website",
	},
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
	return children;
}
