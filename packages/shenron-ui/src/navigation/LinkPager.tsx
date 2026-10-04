/**
 * LinkPager — pagination **en liens**, pour les listes rendues côté serveur.
 *
 * À ne pas confondre avec `components/ui/Pagination.tsx`, qui pagine une liste
 * déjà chargée dans le navigateur (grille filtrée de 1 300 personnages). Ici,
 * chaque page est une URL prérendue : le journal, le fil d'actualité et les
 * index wiki doivent rester cacheables par le CDN et crawlables.
 *
 * `rel="prev"`/`rel="next"` sont posés sur les liens : c'est ce qui dit à un
 * crawler que la série continue sans qu'il ait à deviner.
 *
 * Server component.
 */
import type { ReactNode } from "react";
import { pagerWindow } from "../lib/page-window";
import type { UiLinkComponent } from "./link";

/** Numéros à afficher, `null` = ellipse. Même règle que la pagination client (`@shenron/ui`). */
export { pagerWindow };

export function LinkPager({
	page,
	pages,
	href,
	ariaLabel = "Pagination",
	className = "",
	previousLabel = "Précédent",
	nextLabel = "Suivant",
	positionLabel = `Page ${page} sur ${pages}`,
	linkComponent: Link = "a",
}: {
	page: number;
	pages: number;
	/** Construit l'URL d'une page (page 1 = URL canonique sans suffixe). */
	href: (page: number) => string;
	ariaLabel?: string;
	className?: string;
	previousLabel?: ReactNode;
	nextLabel?: ReactNode;
	positionLabel?: ReactNode;
	linkComponent?: UiLinkComponent;
}) {
	if (pages <= 1) return null;
	const numbers = pagerWindow(page, pages);

	const arrow =
		"inline-flex min-h-11 items-center border-2 px-4 font-display text-[0.75rem] font-bold uppercase tracking-[0.1em] transition-colors";

	return (
		<nav
			aria-label={ariaLabel}
			className={`flex flex-wrap items-center justify-between gap-4 border-t-2 border-white/12 pt-6 ${className}`}
		>
			{page > 1 ? (
				<Link
					href={href(page - 1)}
					rel="prev"
					className={`${arrow} border-white/20 bg-white/[0.06] text-white/80 hover:border-white/40 hover:text-white`}
				>
					← {previousLabel}
				</Link>
			) : (
				<span className={`${arrow} border-white/10 text-white/25`} aria-hidden>
					← {previousLabel}
				</span>
			)}

			{/* Les numéros sont un confort desktop ; sur mobile, précédent/suivant +
			    la position suffisent et évitent une barre qui déborde. */}
			<ul className="hidden items-center gap-1.5 sm:flex">
				{numbers.map((n, i) =>
					n === null ? (
						<li key={`gap-${i}`} className="px-1 text-white/30" aria-hidden>
							…
						</li>
					) : (
						<li key={n}>
							<Link
								href={href(n)}
								aria-current={n === page ? "page" : undefined}
								className={[
									"inline-flex size-10 items-center justify-center border-2 font-display text-[0.8125rem] font-bold tabular-nums transition-colors",
									n === page
										? "border-black bg-dbz-orange text-black"
										: "border-white/15 text-white/70 hover:border-white/40 hover:text-white",
								].join(" ")}
							>
								{n}
							</Link>
						</li>
					)
				)}
			</ul>

			<span className="font-display text-[0.75rem] uppercase tracking-[0.1em] text-white/45 sm:hidden">
				{positionLabel}
			</span>

			{page < pages ? (
				<Link
					href={href(page + 1)}
					rel="next"
					className={`${arrow} border-white/20 bg-white/[0.06] text-white/80 hover:border-white/40 hover:text-white`}
				>
					{nextLabel} →
				</Link>
			) : (
				<span className={`${arrow} border-white/10 text-white/25`} aria-hidden>
					{nextLabel} →
				</span>
			)}
		</nav>
	);
}
