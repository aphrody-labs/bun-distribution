import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Lieux Dragon Ball",
	robots: { index: false, follow: true },
};

/** Compatibilité historique : les fiches de planètes vivent désormais sous Lieux. */
export default function PlanetPage() {
	permanentRedirect("/wiki/lieux");
}
