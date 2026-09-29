import { permanentRedirect } from "next/navigation";

/** Ancienne entrée imbriquée sous le manga : l'index autonome est canonique. */
export default function LegacyMangaInterviewsPage() {
	permanentRedirect("/wiki/interviews");
}
