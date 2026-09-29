"use client";

/**
 * Îlot client à déposer dans une page serveur pour journaliser la visite dans
 * l'historique local. Rend `null` — effet de bord uniquement, comme `TrackView`.
 *
 * Volontairement distinct de `TrackView` (télémétrie) : celui-ci n'envoie rien
 * au serveur, ne dépend d'aucun consentement et sert l'utilisateur, pas la
 * mesure d'audience.
 */
import { useEffect } from "react";
import { recordHistory, type HistoryKind } from "@/lib/history";

export function TrackHistory({
	kind,
	id,
	title,
	href,
	image,
	caption,
}: {
	kind: HistoryKind;
	id: string | number;
	title: string;
	href: string;
	image?: string | null;
	caption?: string | null;
}) {
	useEffect(() => {
		recordHistory({ kind, id: String(id), title, href, image, caption });
	}, [kind, id, title, href, image, caption]);
	return null;
}
