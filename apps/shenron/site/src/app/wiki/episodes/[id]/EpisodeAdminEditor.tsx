"use client";

import type { ComponentProps } from "react";
import { useMe } from "@/lib/use-me";
import { EpisodeMediaEditor } from "./EpisodeMediaEditor";

/**
 * Îlot client de l'éditeur média admin. L'admin est résolu côté client via
 * `/api/me` (useMe) → la page épisode n'appelle plus `isCurrentUserAdmin()`
 * (cookies) en SSR et redevient statique/ISR (cacheable CDN). Cf. piège
 * « JAMAIS de session dans le rendu SSR d'une page publique ».
 */
export function EpisodeAdminEditor(props: ComponentProps<typeof EpisodeMediaEditor>) {
	const me = useMe();
	if (!me?.isAdmin) return null;
	return (
		<div className="mb-12">
			<EpisodeMediaEditor {...props} />
		</div>
	);
}
