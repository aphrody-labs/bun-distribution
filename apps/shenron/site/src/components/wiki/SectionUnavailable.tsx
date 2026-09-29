import type { ReactNode } from "react";
import Link from "next/link";

/**
 * État dégradé d'une page index : la requête n'a rien rendu.
 *
 * Remplace le `notFound()` que ces pages appelaient sur jeu de données vide.
 * Le motif est celui déjà retenu — et documenté — sur `/wiki/chronologie` :
 * sous ISR, un 404 rendu pendant une indisponibilité de PostgreSQL est **mis en
 * cache** et continue d'être servi longtemps après le retour de la base. Un 200
 * `noindex`, lui, se répare tout seul à la revalidation suivante, et `noindex`
 * empêche Google de mémoriser la version vide entre-temps.
 *
 * Un vrai 404 reste le bon comportement pour une ressource **identifiée** qui
 * n'existe pas (`/wiki/films/slug-inconnu`) : ce composant ne concerne que les
 * index, où « vide » signifie presque toujours « panne », jamais « supprimé ».
 *
 * React 19 remonte `<meta>` dans le `<head>` où qu'il soit rendu.
 */
export function SectionUnavailable({
	title,
	message = "Cette section est momentanément indisponible. Elle revient d'elle-même d'ici quelques minutes.",
	links = DEFAULT_LINKS,
}: {
	title: ReactNode;
	message?: ReactNode;
	links?: ReadonlyArray<{ href: string; label: ReactNode }>;
}) {
	return (
		<div className="mx-auto w-full max-w-[720px] px-6 py-24 text-center">
			<meta name="robots" content="noindex, follow" />
			<h1 className="font-display text-3xl font-bold text-white">{title}</h1>
			<p className="mt-4 text-white/60">{message}</p>
			<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
				{links.map((l, i) => (
					<Link
						key={l.href}
						href={l.href}
						className={i === 0 ? "dbz-button !text-xs" : "dbz-button-ghost !text-xs"}
					>
						{l.label}
					</Link>
				))}
			</div>
		</div>
	);
}

/** Rubriques ouvertes en permanence — toujours un point de sortie valide. */
const DEFAULT_LINKS = [
	{ href: "/wiki/episodes", label: "Les épisodes" },
	{ href: "/wiki/films", label: "Les films" },
	{ href: "/wiki/manga", label: "Le manga" },
] as const;
