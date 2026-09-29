"use client";

/**
 * TrackView — îlot client de tracking de vue d'entité wiki.
 *
 * À déposer dans une page serveur (`/wiki/.../[id]`) pour émettre une
 * `wiki_view` typée au montage, sans transformer la page en Client Component ni
 * importer la télémétrie côté serveur. Rend `null` (pur effet de bord).
 *
 * No-op sans consentement / sous Do-Not-Track (géré par `track()`).
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { noterVisite } from "@/lib/historique-local";
import { trackWikiView, type TelemetryEvent } from "@/lib/telemetry";

type WikiViewProps = Extract<TelemetryEvent, { name: "wiki_view" }>["props"];

/** Rubrique lisible, pour l'affichage de l'historique. */
const RUBRIQUE: Record<string, string> = {
	character: "Personnage",
	saga: "Saga",
	movie: "Film",
	episode: "Épisode",
	planet: "Monde",
	technique: "Technique",
	game: "Jeu",
	manga: "Manga",
	race: "Race",
	arc: "Arc",
};

export function TrackView({
	entityType,
	entityId,
	entityName,
	series,
	image,
}: WikiViewProps & { image?: string | null }) {
	const pathname = usePathname();

	useEffect(() => {
		trackWikiView(entityType, entityId, { entityName, series });
		// Re-track si on navigue d'une fiche à l'autre (clé id change).
	}, [entityType, entityId, entityName, series]);

	// Marque-page LOCAL, indépendant de la télémétrie : il doit fonctionner
	// aussi pour qui a refusé la mesure d'audience — c'est un service rendu au
	// lecteur, pas une collecte.
	useEffect(() => {
		if (!entityName || !pathname) return;
		noterVisite({
			href: pathname,
			titre: entityName,
			rubrique: RUBRIQUE[entityType] ?? "Fiche",
			image: image ?? null,
		});
	}, [pathname, entityType, entityName, image]);

	return null;
}
