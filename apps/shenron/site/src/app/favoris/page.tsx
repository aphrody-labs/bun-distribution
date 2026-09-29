import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FavoritesList } from "./FavoritesList";
import { UserNav } from "@/components/user/UserNav";

/**
 * `/favoris` — la liste personnelle, rendue **entièrement côté client**.
 *
 * La page elle-même reste un composant serveur statique et ne lit ni cookie ni
 * session : elle est donc cachée par le CDN comme n'importe quelle page
 * publique. Le contenu personnel arrive après l'hydratation, depuis
 * `localStorage` (et depuis `/api/favorites` si l'utilisateur est connecté).
 */
export const metadata: Metadata = {
	title: "Mes favoris",
	description:
		"Les épisodes, films et chapitres que tu as mis de côté sur Dragon Ball France. Conservés sur cet appareil, et synchronisés si tu es connecté.",
	// Page strictement personnelle : rien à indexer.
	robots: { index: false, follow: false },
};

export default function FavorisPage() {
	return (
		<PageShell width="default">
			<UserNav />
			<Breadcrumbs className="mb-8" items={[{ label: "Mes favoris" }]} />
			<PageHeader
				eyebrow="Ton espace"
				title="Mes favoris"
				className="mb-10"
				subtitle="Ce que tu as mis de côté. Conservé sur cet appareil — connecte-toi pour le retrouver partout."
			/>
			<FavoritesList />
		</PageShell>
	);
}
